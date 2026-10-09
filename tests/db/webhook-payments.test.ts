import { describe, it, expect, beforeEach } from "vitest";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { chargeScheduledItem } from "../../lib/stripe/invoices";
import { issueGiftCards } from "../../lib/giftcards/db";
import { convertMinor } from "../../lib/pricing/convert";
import { seedBooking } from "./cronFixtures";
import {
  EVENT,
  NOW,
  RATES,
  buyerId,
  checkout,
  count,
  event,
  giftCard,
  invoiceEvent,
  planBooking,
  world,
  type World,
} from "./webhookFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
});

async function bookingStatus(id: string) {
  return (await w.db.query<{ status: string }>("select status from bookings where id = $1", [id])).rows[0].status;
}

async function item(id: string) {
  return (
    await w.db.query<{ status: string; attempts: number; stripe_invoice_id: string | null }>(
      "select status, attempts, stripe_invoice_id from payment_schedule_items where id = $1",
      [id],
    )
  ).rows[0];
}

describe("scheduled payments", () => {
  it("invoice.paid on the last item marks the booking paid and sends a receipt", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(invoiceEvent("evt_ip", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(await bookingStatus(bookingId)).toBe("paid");
    expect(await item(items[1].id)).toMatchObject({ status: "paid", stripe_invoice_id: "in_evt_ip" });
    const base = (await w.db.query<{ amount_paid_base_minor: number }>("select amount_paid_base_minor from bookings")).rows[0];
    expect(base.amount_paid_base_minor).toBe(240000);
    expect(w.emails.map((e) => e.kind)).toEqual(["scheduled_payment_receipt"]);
    expect(w.emails[0].to).toBe("layla@email.com");
  });

  it("invoice.paid on an earlier item keeps the booking part paid", async () => {
    const { bookingId, items } = await planBooking(w, "instalments");
    await handleStripeEvent(
      invoiceEvent("evt_ip", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
    expect((await item(items[1].id)).status).toBe("paid");
  });

  it("refuses an invoice.paid whose amount does not match the item, and alerts Tanya", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(invoiceEvent("evt_z", "invoice.paid", items[1].id, bookingId, { amount_paid: 0 }), w.deps);
    await handleStripeEvent(invoiceEvent("evt_c", "invoice.paid", items[1].id, bookingId, { currency: "aed" }), w.deps);
    expect((await item(items[1].id)).status).toBe("scheduled");
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
    expect(w.emails.map((e) => [e.kind, e.data.invoiceId])).toEqual([
      ["admin_error", "in_evt_z"],
      ["admin_error", "in_evt_c"],
    ]);
  });

  it("accepts an upper-case invoice currency", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(invoiceEvent("evt_u", "invoice.paid", items[1].id, bookingId, { currency: "EUR" }), w.deps);
    expect((await item(items[1].id)).status).toBe("paid");
  });

  it("invoice.payment_failed marks the item failed and emails the guest and Tanya", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(invoiceEvent("evt_f", "invoice.payment_failed", items[1].id, bookingId), w.deps);
    expect(await item(items[1].id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
    expect(w.emails.map((e) => e.kind).sort()).toEqual(["admin_payment_failed", "scheduled_payment_failed"]);
    const guest = w.emails.find((e) => e.kind === "scheduled_payment_failed")!;
    expect(guest.to).toBe("layla@email.com");
    expect(guest.data.payUrl).toBe("https://invoice.stripe.test/i/1");
    expect(guest.data.balanceDueOn).toBe("2027-05-31");
  });

  it("ignores invoice events for cancelled bookings: a failed retry only alerts Tanya", async () => {
    const { bookingId, items } = await planBooking(w);
    await w.db.query("update bookings set status = 'cancelled'");
    await handleStripeEvent(invoiceEvent("evt_f", "invoice.payment_failed", items[1].id, bookingId), w.deps);
    expect(await item(items[1].id)).toMatchObject({ status: "scheduled", attempts: 0 });
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect(w.emails).toHaveLength(1);
    expect(w.emails[0].kind).toBe("admin_error");
    expect(w.emails[0].to).not.toBe("layla@email.com");
    expect(String(w.emails[0].data.problem)).toBe("Stripe still retrying invoice in_evt_f for an inactive booking");
  });

  it("a payment on a cancelled booking changes nothing on the booking; it is refunded and Tanya told", async () => {
    const { bookingId, items } = await planBooking(w);
    await w.db.query("update bookings set status = 'cancelled'");
    w.stripe.invoicePaymentIntent.in_evt_p = "pi_late";
    await handleStripeEvent(invoiceEvent("evt_p", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(await item(items[1].id)).toMatchObject({ status: "scheduled", attempts: 0 });
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect(w.stripe.refundsCreated).toHaveLength(1);
    expect(w.emails).toHaveLength(1);
    expect(w.emails[0].kind).toBe("admin_error");
    expect(w.emails[0].data.context).toBe("payment_on_inactive_booking_refunded");
  });

  it("ignores invoices that are not scheduled payments", async () => {
    expect(await handleStripeEvent(event("evt_o", "invoice.paid", { id: "in_x", metadata: {} }), w.deps)).toBe(
      "processed",
    );
    expect(w.emails).toEqual([]);
  });
});

describe("revenue in AED (bookings.amount_aed_minor) follows every payment", () => {
  const aedOf = async (id: string) =>
    (await w.db.query<{ a: number }>("select amount_aed_minor as a from bookings where id = $1", [id])).rows[0].a;

  it("an instalment paid in EUR adds its AED value at the day's rates", async () => {
    const { bookingId, items } = await planBooking(w);
    const before = await aedOf(bookingId);
    expect(before).toBe(convertMinor(48000, "EUR", "AED", { ...RATES, USD: 1 }, "round"));
    await handleStripeEvent(invoiceEvent("evt_ip", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(await aedOf(bookingId)).toBe(before + convertMinor(192000, "EUR", "AED", { ...RATES, USD: 1 }, "round"));
  });

  it("an instalment of an AED booking adds exactly its amount", async () => {
    const b = await seedBooking(w.db, {
      slug: "test-event",
      status: "deposit_paid",
      booker: { name: "Eve E", email: "eve@x.com" },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 5600, status: "paid" },
        { seq: 1, dueOn: "2027-01-20", amount: 22400, status: "scheduled" },
      ],
    });
    await handleStripeEvent(
      invoiceEvent("evt_aed", "invoice.paid", b.itemIds[1], b.bookingId, { amount_paid: 22400, currency: "aed" }),
      w.deps,
    );
    expect(await aedOf(b.bookingId)).toBe(28000);
    expect(await bookingStatus(b.bookingId)).toBe("paid");
  });

  it("without exchange rates the payment is still recorded, the AED value is left out and Tanya is told", async () => {
    const { bookingId, items } = await planBooking(w);
    const before = await aedOf(bookingId);
    await handleStripeEvent(invoiceEvent("evt_ip", "invoice.paid", items[1].id, bookingId), { ...w.deps, usdRates: async () => ({}) });
    expect((await item(items[1].id)).status).toBe("paid");
    expect(await aedOf(bookingId)).toBe(before);
    expect(w.emails.map((e) => [e.kind, e.data.context]).sort()).toEqual([
      ["admin_error", "revenue_aed_unknown"],
      ["scheduled_payment_receipt", undefined],
    ]);
  });
});

describe("pay_rest and update_card", () => {
  it("pay_rest marks remaining items paid, voids their open invoices, booking paid", async () => {
    const { bookingId, items } = await planBooking(w, "instalments");
    await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW);
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

  it("update_card sets the default card and updates every open invoice (paginated)", async () => {
    const { items } = await planBooking(w, "instalments");
    await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW);
    await chargeScheduledItem(w.db, w.stripe, items[2].id, NOW);
    w.stripe.invoiceStatus.in_test_1 = "open";
    w.stripe.invoiceStatus.in_test_2 = "open";
    w.stripe.pageSize = 1;
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
    expect(w.stripe.invoiceUpdates).toEqual([
      { id: "in_test_1", params: { default_payment_method: "pm_of_seti_new" } },
      { id: "in_test_2", params: { default_payment_method: "pm_of_seti_new" } },
    ]);
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

  const giftSession = (id: string, metadata: Record<string, string>) =>
    event(id, "checkout.session.completed", {
      object: "checkout.session",
      id: "cs_gift",
      mode: "payment",
      payment_status: "paid",
      metadata: { kind: "gift_purchase", ...metadata },
      payment_intent: "pi_gift",
      amount_total: 21000,
      currency: "gbp",
    });

  it("gift_purchase activates the cards and records the payment", async () => {
    const batch = await pendingGifts(2);
    await handleStripeEvent(giftSession("evt_gp", { batch_id: batch }), w.deps);
    const cards = await w.db.query<Record<string, unknown>>(
      "select status, balance_aed_minor, amount_paid_minor, presentment_currency, stripe_payment_intent from gift_cards order by amount_paid_minor",
    );
    const card = { status: "active", balance_aed_minor: 50000, amount_paid_minor: 10500, presentment_currency: "GBP", stripe_payment_intent: "pi_gift" };
    expect(cards.rows).toEqual([card, card]);
    expect(w.emails).toEqual([]);
  });

  it("gift_purchase with an invalid batch id alerts Tanya instead of failing", async () => {
    await pendingGifts(1);
    expect(await handleStripeEvent(giftSession("evt_bad", { batch_id: "not-a-uuid" }), w.deps)).toBe("processed");
    expect((await w.db.query<{ status: string }>("select status from gift_cards")).rows[0].status).toBe("pending_payment");
    expect(w.emails.map((e) => [e.kind, e.data.context])).toEqual([["admin_error", "gift_purchase_bad_metadata"]]);
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

  async function refundable() {
    const { bookingId, items } = await planBooking(w);
    await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW);
    w.stripe.invoiceStatus.in_test_1 = "open";
    await w.db.query("update payment_schedule_items set status = 'failed' where id = $1", [items[1].id]);
    return bookingId;
  }

  it("a fully refunded booking payment marks the booking refunded and stops later payments", async () => {
    const bookingId = await refundable();
    await handleStripeEvent(refund("evt_rb", "pi_cs_test_1"), w.deps);
    expect(await bookingStatus(bookingId)).toBe("refunded");
    expect(await count(w.db, "select * from payment_schedule_items where status in ('scheduled', 'failed')")).toBe(0);
    expect(w.stripe.voided).toEqual(["in_test_1"]);
  });

  it("voids open invoices on retry after the first void failed", async () => {
    const bookingId = await refundable();
    w.stripe.voidError = new Error("stripe down");
    const evt = refund("evt_rv", "pi_cs_test_1");
    await expect(handleStripeEvent(evt, w.deps)).rejects.toThrow("stripe down");
    expect(await bookingStatus(bookingId)).toBe("refunded"); // committed before the void
    expect(await count(w.db, "select * from stripe_events where id = 'evt_rv'")).toBe(0);
    expect(await handleStripeEvent(evt, w.deps)).toBe("processed");
    expect(w.stripe.voided).toEqual(["in_test_1"]);
  });

  it("voids open invoices when an already cancelled booking's payment is refunded", async () => {
    const bookingId = await refundable();
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    await handleStripeEvent(refund("evt_rc", "pi_cs_test_1"), w.deps);
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect(w.stripe.voided).toEqual(["in_test_1"]);
  });

  it("a partial booking refund changes nothing", async () => {
    const { bookingId } = await planBooking(w);
    await handleStripeEvent(refund("evt_rp", "pi_cs_test_1", { refunded: false, amount_refunded: 100 }), w.deps);
    expect(await bookingStatus(bookingId)).toBe("deposit_paid");
  });
});

describe("failures inside the transaction", () => {
  it("leave no stripe_events row", async () => {
    const evt = event("evt_bad", "checkout.session.completed", {
      id: "cs_x",
      mode: "payment",
      payment_status: "paid",
      metadata: { kind: "booking", pending_booking_id: "00000000-0000-0000-0000-000000000000" },
    });
    await expect(handleStripeEvent(evt, w.deps)).rejects.toThrow("PENDING_NOT_FOUND");
    expect(await count(w.db, "select * from stripe_events")).toBe(0);
  });
});
