import { describe, it, expect, beforeEach } from "vitest";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { chargeScheduledItem } from "../../lib/stripe/invoices";
import { issueGiftCards } from "../../lib/giftcards/db";
import {
  EVENT,
  RETREAT,
  buyerId,
  checkout,
  completedBooking,
  count,
  event,
  giftCard,
  world,
  type World,
} from "./webhookFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
});

/** A confirmed retreat booking on deposit + balance (2 items: deposit paid, balance scheduled). */
async function planBooking(option: "deposit_balance" | "instalments" = "deposit_balance") {
  const { pendingId, sessionId } = await checkout(w, RETREAT, {
    lines: [{ ticketKey: "shared", qty: 1 }],
    paymentOption: option,
    scheduleConsent: true,
  });
  await handleStripeEvent(completedBooking("evt_book", pendingId, sessionId, { customer: "cus_test_1" }), w.deps);
  const b = await w.db.query<{ id: string }>("select id from bookings");
  const items = await w.db.query<{ id: string; seq: number; amount_minor: number }>(
    "select id, seq, amount_minor from payment_schedule_items order by seq",
  );
  w.emails.length = 0;
  return { bookingId: b.rows[0].id, items: items.rows };
}

const invoiceEvent = (id: string, type: string, itemId: string, bookingId: string, over: Record<string, unknown> = {}) =>
  event(id, type, {
    object: "invoice",
    id: `in_${id}`,
    metadata: { kind: "scheduled_payment", item_id: itemId, booking_id: bookingId },
    amount_paid: 192000,
    amount_due: 192000,
    currency: "eur",
    hosted_invoice_url: "https://invoice.stripe.test/i/1",
    ...over,
  });

async function bookingStatus(id: string) {
  return (await w.db.query<{ status: string }>("select status from bookings where id = $1", [id])).rows[0].status;
}

describe("scheduled payments", () => {
  it("invoice.paid on the last item marks the booking paid and sends a receipt", async () => {
    const { bookingId, items } = await planBooking();
    await handleStripeEvent(invoiceEvent("evt_ip", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(await bookingStatus(bookingId)).toBe("paid");
    const it1 = (await w.db.query<{ status: string; stripe_invoice_id: string }>(
      "select status, stripe_invoice_id from payment_schedule_items where id = $1",
      [items[1].id],
    )).rows[0];
    expect(it1).toEqual({ status: "paid", stripe_invoice_id: "in_evt_ip" });
    const base = (await w.db.query<{ amount_paid_base_minor: number }>("select amount_paid_base_minor from bookings")).rows[0];
    expect(base.amount_paid_base_minor).toBe(240000);
    expect(w.emails.map((e) => e.kind)).toEqual(["scheduled_payment_receipt"]);
    expect(w.emails[0].to).toBe("layla@email.com");
  });

  it("invoice.paid on an earlier item keeps the booking part paid", async () => {
    const { bookingId, items } = await planBooking("instalments");
    await handleStripeEvent(invoiceEvent("evt_ip", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
  });

  it("invoice.payment_failed marks the item failed and emails the guest and Tanya", async () => {
    const { bookingId, items } = await planBooking();
    await handleStripeEvent(invoiceEvent("evt_f", "invoice.payment_failed", items[1].id, bookingId), w.deps);
    const it1 = (await w.db.query<{ status: string; attempts: number }>(
      "select status, attempts from payment_schedule_items where id = $1",
      [items[1].id],
    )).rows[0];
    expect(it1).toEqual({ status: "failed", attempts: 1 });
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
    expect(w.emails.map((e) => e.kind).sort()).toEqual(["admin_payment_failed", "scheduled_payment_failed"]);
    const guest = w.emails.find((e) => e.kind === "scheduled_payment_failed")!;
    expect(guest.to).toBe("layla@email.com");
    expect(guest.data.payUrl).toBe("https://invoice.stripe.test/i/1");
    expect(guest.data.balanceDueOn).toBe("2027-05-31");
  });

  it("ignores invoice events for cancelled bookings", async () => {
    const { bookingId, items } = await planBooking();
    await w.db.query("update bookings set status = 'cancelled'");
    await handleStripeEvent(invoiceEvent("evt_f", "invoice.payment_failed", items[1].id, bookingId), w.deps);
    await handleStripeEvent(invoiceEvent("evt_p", "invoice.paid", items[1].id, bookingId), w.deps);
    const it1 = (await w.db.query<{ status: string; attempts: number }>(
      "select status, attempts from payment_schedule_items where id = $1",
      [items[1].id],
    )).rows[0];
    expect(it1).toEqual({ status: "scheduled", attempts: 0 });
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect(w.emails).toEqual([]);
  });

  it("ignores invoices that are not scheduled payments", async () => {
    expect(await handleStripeEvent(event("evt_o", "invoice.paid", { id: "in_x", metadata: {} }), w.deps)).toBe(
      "processed",
    );
    expect(w.emails).toEqual([]);
  });
});

describe("chargeScheduledItem", () => {
  it("creates and pays an invoice in base currency with the customer's default card", async () => {
    const { bookingId, items } = await planBooking();
    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id)).toEqual({ status: "charged", invoiceId: "in_test_1" });
    expect(w.stripe.invoicesCreated[0].params).toMatchObject({
      customer: "cus_test_1",
      currency: "eur",
      collection_method: "charge_automatically",
      default_payment_method: "pm_of_pi_cs_test_1",
      metadata: { kind: "scheduled_payment", item_id: items[1].id, booking_id: bookingId },
    });
    expect(w.stripe.invoiceItemsCreated[0]).toMatchObject({ invoice: "in_test_1", amount: 192000, currency: "eur" });
    expect(w.stripe.invoiceStatus.in_test_1).toBe("paid");
    const it1 = (await w.db.query<{ stripe_invoice_id: string }>(
      "select stripe_invoice_id from payment_schedule_items where id = $1",
      [items[1].id],
    )).rows[0];
    expect(it1.stripe_invoice_id).toBe("in_test_1");
    // A second run does not create another invoice.
    expect((await chargeScheduledItem(w.db, w.stripe, items[1].id)).status).toBe("skipped");
    expect(w.stripe.invoicesCreated).toHaveLength(1);
  });

  it("reports a declined card as failed (the webhook records it)", async () => {
    const { items } = await planBooking();
    w.stripe.payError = Object.assign(new Error("declined"), { type: "StripeCardError" });
    expect((await chargeScheduledItem(w.db, w.stripe, items[1].id)).status).toBe("failed");
  });

  it("skips a cancelled booking", async () => {
    const { items } = await planBooking();
    await w.db.query("update bookings set status = 'cancelled'");
    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id)).toEqual({ status: "skipped" });
    expect(w.stripe.invoicesCreated).toEqual([]);
  });
});

describe("pay_rest and update_card", () => {
  it("pay_rest marks remaining items paid, voids their open invoices, booking paid", async () => {
    const { bookingId, items } = await planBooking("instalments");
    await chargeScheduledItem(w.db, w.stripe, items[1].id);
    w.stripe.invoiceStatus.in_test_1 = "open"; // charge failed and Stripe is retrying
    await w.db.query("update payment_schedule_items set status = 'failed' where id = $1", [items[1].id]);
    await handleStripeEvent(
      event("evt_rest", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_rest",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "pay_rest", booking_id: bookingId },
        payment_intent: "pi_rest",
      }),
      w.deps,
    );
    expect(await bookingStatus(bookingId)).toBe("paid");
    expect(await count(w.db, "select * from payment_schedule_items where status <> 'paid'")).toBe(0);
    expect(w.stripe.voided).toEqual(["in_test_1"]);
  });

  it("update_card sets the default card and updates open invoices", async () => {
    const { items } = await planBooking();
    await chargeScheduledItem(w.db, w.stripe, items[1].id);
    w.stripe.invoiceStatus.in_test_1 = "open";
    const person = (await w.db.query<{ id: string }>("select id from people where email = 'layla@email.com'")).rows[0].id;
    await handleStripeEvent(
      event("evt_card", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_card",
        mode: "setup",
        metadata: { kind: "update_card", person_id: person },
        setup_intent: "seti_new",
        customer: "cus_test_1",
      }),
      w.deps,
    );
    expect(w.stripe.customerUpdates.at(-1)).toEqual({
      id: "cus_test_1",
      params: { invoice_settings: { default_payment_method: "pm_of_seti_new" } },
    });
    expect(w.stripe.invoiceUpdates).toEqual([{ id: "in_test_1", params: { default_payment_method: "pm_of_seti_new" } }]);
  });
});

describe("gift purchases and refunds", () => {
  async function pendingGifts(n: number, ref = "cs_gift") {
    const buyer = await buyerId(w.db);
    const batch = (
      await w.db.query<{ id: string }>(
        "insert into gift_card_batches (buyer_person_id, quantity) values ($1, $2) returning id",
        [buyer, n],
      )
    ).rows[0].id;
    await issueGiftCards(w.db, {
      count: n,
      initialAedMinor: 50000,
      buyerPersonId: buyer,
      deliverOn: "2027-01-10",
      batchId: batch,
      paymentRef: ref,
    });
    return batch;
  }

  it("gift_purchase activates the cards and records the payment", async () => {
    const batch = await pendingGifts(2);
    await handleStripeEvent(
      event("evt_gp", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_gift",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "gift_purchase", batch_id: batch },
        payment_intent: "pi_gift",
        amount_total: 21000,
        currency: "gbp",
      }),
      w.deps,
    );
    const cards = await w.db.query<Record<string, unknown>>(
      "select status, balance_aed_minor, amount_paid_minor, presentment_currency, stripe_payment_intent from gift_cards order by amount_paid_minor",
    );
    expect(cards.rows).toEqual([
      { status: "active", balance_aed_minor: 50000, amount_paid_minor: 10500, presentment_currency: "gbp", stripe_payment_intent: "pi_gift" },
      { status: "active", balance_aed_minor: 50000, amount_paid_minor: 10500, presentment_currency: "gbp", stripe_payment_intent: "pi_gift" },
    ]);
    expect(w.emails).toEqual([]);
  });

  const refund = (id: string, pi: string, over: Record<string, unknown> = {}) =>
    event(id, "charge.refunded", {
      object: "charge",
      id: `ch_${id}`,
      payment_intent: pi,
      amount: 50000,
      amount_refunded: 50000,
      refunded: true,
      ...over,
    });

  it("gift purchase refund voids unused cards", async () => {
    await giftCard(w.db, 50000, "pi_g");
    await handleStripeEvent(refund("evt_r", "pi_g"), w.deps);
    const c = (await w.db.query<{ status: string; balance_aed_minor: number }>("select status, balance_aed_minor from gift_cards"))
      .rows[0];
    expect(c).toEqual({ status: "void", balance_aed_minor: 0 });
    expect(w.emails).toEqual([]);
  });

  it("partly used gift card refund emails Tanya and keeps the card", async () => {
    const code = await giftCard(w.db, 10000, "pi_g");
    await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: code });
    await handleStripeEvent(refund("evt_r", "pi_g"), w.deps);
    expect((await w.db.query<{ status: string }>("select status from gift_cards")).rows[0].status).toBe("active");
    expect(w.emails.map((e) => [e.kind, e.data.context])).toEqual([["admin_error", "gift_refund_partly_used"]]);
  });

  it("a fully refunded booking payment marks the booking refunded and stops later payments", async () => {
    const { bookingId, items } = await planBooking();
    await chargeScheduledItem(w.db, w.stripe, items[1].id);
    w.stripe.invoiceStatus.in_test_1 = "open";
    await w.db.query("update payment_schedule_items set status = 'failed' where id = $1", [items[1].id]);
    await handleStripeEvent(refund("evt_rb", "pi_cs_test_1"), w.deps);
    expect(await bookingStatus(bookingId)).toBe("refunded");
    expect(await count(w.db, "select * from payment_schedule_items where status in ('scheduled', 'failed')")).toBe(0);
    expect(w.stripe.voided).toEqual(["in_test_1"]);
  });

  it("a partial booking refund changes nothing", async () => {
    const { bookingId } = await planBooking();
    await handleStripeEvent(refund("evt_rp", "pi_cs_test_1", { refunded: false, amount_refunded: 100 }), w.deps);
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
  });
});

describe("failures inside the transaction", () => {
  it("leave no stripe_events row", async () => {
    const evt = completedBooking("evt_bad", "00000000-0000-0000-0000-000000000000", "cs_x");
    await expect(handleStripeEvent(evt, w.deps)).rejects.toThrow("PENDING_NOT_FOUND");
    expect(await count(w.db, "select * from stripe_events")).toBe(0);
  });
});
