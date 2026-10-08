import { describe, it, expect, beforeEach } from "vitest";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { startPayRest } from "../../lib/stripe/selfServe";
import { chargeScheduledItem } from "../../lib/stripe/invoices";
import { NOW, ORIGIN, count, event, invoiceEvent, planBooking, world, type World } from "./webhookFixtures";

let w: World;
let bookingId: string;
let items: { id: string; seq: number; amount_minor: number }[];
let bookerId: string;

beforeEach(async () => {
  w = await world();
  ({ bookingId, items } = await planBooking(w, "instalments"));
  bookerId = (await w.db.query<{ booker_person_id: string }>("select booker_person_id from bookings")).rows[0]
    .booker_person_id;
  w.stripe.sessions.length = 0;
});

const status = async () =>
  (await w.db.query<{ status: string }>("select status from bookings where id = $1", [bookingId])).rows[0].status;

/** Starts "Pay the rest now" through the real code path and returns the completed-session event. */
async function payRestEvent(evtId = "evt_rest", over: Record<string, unknown> = {}) {
  await startPayRest({ db: w.db, stripe: w.stripe, origin: ORIGIN }, bookingId, bookerId);
  const s = w.stripe.sessions[w.stripe.sessions.length - 1];
  return event(evtId, "checkout.session.completed", {
    object: "checkout.session",
    id: "cs_rest_1",
    mode: "payment",
    payment_status: "paid",
    metadata: s.metadata,
    amount_total: s.line_items![0].price_data!.unit_amount,
    currency: "eur",
    payment_intent: "pi_rest_1",
    ...over,
  });
}

const unpaidSum = () => items.filter((i) => i.seq > 0).reduce((s, i) => s + i.amount_minor, 0);

describe("pay_rest completion", () => {
  it("marks every item in the session paid and the booking paid, with no refund", async () => {
    const evt = await payRestEvent();
    await handleStripeEvent(evt, w.deps);
    expect(await status()).toBe("paid");
    expect(await count(w.db, "select * from payment_schedule_items where status <> 'paid'")).toBe(0);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.emails.filter((e) => e.kind === "admin_error")).toEqual([]);
  });

  it("refunds the excess when an instalment was paid in between, and tells Tanya", async () => {
    const evt = await payRestEvent();
    // The scheduled charge for item 1 lands before the guest finishes Checkout.
    await handleStripeEvent(
      invoiceEvent("evt_inv", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    expect(await count(w.db, "select * from payment_schedule_items where id = $1 and status = 'paid'", [items[1].id])).toBe(1);
    w.emails.length = 0;
    await handleStripeEvent(evt, w.deps);

    expect(await status()).toBe("paid");
    expect(w.stripe.refundsCreated).toEqual([
      {
        params: { payment_intent: "pi_rest_1", amount: items[1].amount_minor },
        options: { idempotencyKey: "efzin-payrest-refund-cs_rest_1" },
      },
    ]);
    const alerts = w.emails.filter((e) => e.kind === "admin_error");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data).toMatchObject({ context: "pay_rest_excess_refunded", bookingId, refundedMinor: items[1].amount_minor });
  });

  it("records the refund id and never refunds again on a later retry of the same event", async () => {
    const evt = await payRestEvent();
    await handleStripeEvent(
      invoiceEvent("evt_inv", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    await handleStripeEvent(evt, w.deps);
    expect(w.stripe.refundsCreated).toHaveLength(1);
    const st = await w.db.query<{ refund_id: string | null }>("select refund_id from pay_rest_settlements");
    expect(st.rows[0].refund_id).toBe("re_test_1");
    // A redelivery long after Stripe's 24 h idempotency window (the event row is gone, e.g. after a failed step).
    await w.db.query("delete from stripe_events where id = $1", [evt.id]);
    await handleStripeEvent(evt, w.deps);
    expect(w.stripe.refundsCreated).toHaveLength(1);
  });

  it("when the refund fails, still voids the settled items' invoices and alerts Tanya without failing", async () => {
    // Item 2 has an open invoice that Stripe is retrying.
    await chargeScheduledItem(w.db, w.stripe, items[2].id, NOW);
    const inv = (await w.db.query<{ stripe_invoice_id: string }>("select stripe_invoice_id from payment_schedule_items where id = $1", [items[2].id])).rows[0].stripe_invoice_id;
    w.stripe.invoiceStatus[inv] = "open";
    await w.db.query("update payment_schedule_items set status = 'failed' where id = $1", [items[2].id]);
    const evt = await payRestEvent();
    await handleStripeEvent(
      invoiceEvent("evt_inv", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    w.emails.length = 0;
    w.stripe.refundError = Object.assign(new Error("card_declined"), { statusCode: 402 });

    expect(await handleStripeEvent(evt, w.deps)).toBe("processed");
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.stripe.voided).toContain(inv);
    const alerts = w.emails.filter((e) => e.kind === "admin_error");
    expect(alerts.map((a) => a.data.context)).toContain("pay_rest_refund_failed");
    expect(alerts.find((a) => a.data.context === "pay_rest_refund_failed")?.data).toMatchObject({
      bookingId,
      excessMinor: items[1].amount_minor,
    });
  });

  it("with a different session currency (Adaptive Pricing) it never auto-refunds, and alerts when a listed item was not settled", async () => {
    const evt = await payRestEvent("evt_rest", { currency: "gbp", amount_total: 123456 });
    await handleStripeEvent(
      invoiceEvent("evt_inv", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    w.emails.length = 0;
    await handleStripeEvent(evt, w.deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    const alerts = w.emails.filter((e) => e.kind === "admin_error");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data).toMatchObject({ context: "pay_rest_needs_review", bookingId, currency: "GBP" });
  });

  it("with a different session currency and everything settled as expected, no alert", async () => {
    const evt = await payRestEvent("evt_rest", { currency: "gbp", amount_total: 123456 });
    await handleStripeEvent(evt, w.deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.emails.filter((e) => e.kind === "admin_error")).toEqual([]);
    expect(await status()).toBe("paid");
  });

  it("refunds the whole payment when the booking was cancelled before Checkout completed", async () => {
    const evt = await payRestEvent();
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    await handleStripeEvent(evt, w.deps);

    expect(await status()).toBe("cancelled");
    expect(await count(w.db, "select * from payment_schedule_items where status = 'paid'")).toBe(1); // deposit only
    expect(w.stripe.refundsCreated).toHaveLength(1);
    expect(w.stripe.refundsCreated[0].params).toEqual({ payment_intent: "pi_rest_1", amount: unpaidSum() });
    expect(w.emails.filter((e) => e.kind === "admin_error")).toHaveLength(1);
  });

  it("a second delivery for the same session (async success) neither re-marks nor refunds a different amount", async () => {
    const evt = await payRestEvent();
    await handleStripeEvent(evt, w.deps);
    const again = { ...evt, id: "evt_rest_async", type: "checkout.session.async_payment_succeeded" } as typeof evt;
    await handleStripeEvent(again, w.deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await status()).toBe("paid");
  });

  it("only marks the items named in the session, not items added later", async () => {
    const evt = await payRestEvent();
    const last = Math.max(...items.map((i) => i.seq));
    await w.db.query(
      "insert into payment_schedule_items (booking_id, seq, due_on, amount_minor, currency) values ($1, $2, '2027-05-01', 5000, 'EUR')",
      [bookingId, last + 1],
    );
    await handleStripeEvent(evt, w.deps);
    expect(await count(w.db, "select * from payment_schedule_items where status = 'scheduled'")).toBe(1);
    expect(await status()).toBe("deposit_paid");
    expect(w.stripe.refundsCreated).toEqual([]);
  });
});
