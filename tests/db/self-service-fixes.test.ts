import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelBooking } from "../../lib/booking/cancel";
import { runCancelExperience } from "../../lib/booking/cancelExperience";
import { transferSpot } from "../../lib/booking/transfer";
import { handleWaitlist, joinWaitlist } from "../../lib/booking/waitlist";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { chargeScheduledItem } from "../../lib/stripe/invoices";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENT, ORIGIN, checkout, invoiceEvent, planBooking, world, type World } from "./webhookFixtures";
import { EVENT_START, RETREAT_START, daysBefore, giftBalance, hoursBefore, paidEvent, refunds, retreatPlan, status } from "./selfServiceFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
const opts = () => ({ sendEmail: w.deps.sendEmail, origin: ORIGIN });

describe("waitlist for sold-out content", () => {
  it("someone joins a sold_out experience, a cancellation frees a spot, they are emailed and the link is bookable", async () => {
    await w.db.query("update experiences set status = 'sold_out' where slug = 'test-event'");
    const now = daysBefore(EVENT_START, 5);
    const tt = (await w.db.query<{ id: string }>("select id from ticket_types where key = 'small'")).rows[0].id;
    const b = await paidEvent(w);
    expect(await joinWaitlist(w.db, tt, { name: "Amy A", email: "amy@x.com" }, now)).toBe("joined");

    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    const mail = w.emails.filter((e) => e.kind === "waitlist_open");
    expect(mail.map((e) => e.to)).toEqual(["amy@x.com"]);
    expect(mail[0].data.link).toBe(`${ORIGIN}/book/test-event`);
    // The booking page and checkout accept sold_out content; the hold enforces the real capacity.
    const out = await checkout(w, { ...EVENT, status: "sold_out" }, { lines: [{ ticketKey: "small", qty: 1 }] }, now);
    expect(out.sessionId).toMatch(/^cs_test_/);
  });

  it("the public form answers the same whether or not the email is already on the list", async () => {
    const now = daysBefore(EVENT_START, 5);
    await paidEvent(w);
    const body = { slug: "test-event", ticket: "small", name: "Amy", email: "amy@x.com" };
    const first = await handleWaitlist(body, { db: w.db, now });
    const again = await handleWaitlist(body, { db: w.db, now });
    expect(first).toEqual(again);
    expect(first.result).toBe("joined");
  });
});

describe("no charge after a cancellation", () => {
  it("a cancel that commits while the daily charge is building the invoice: nothing is charged and the draft is deleted", async () => {
    const { bookingId, items } = await planBooking(w);
    const now = new Date("2027-05-31T02:00:00Z");
    w.stripe.onInvoiceCreate = async () => {
      await cancelBooking(w.db, w.stripe, bookingId, "refund", "guest", now, opts());
    };
    const r = await chargeScheduledItem(w.db, w.stripe, items[1].id, now);
    expect(r).toEqual({ status: "skipped" });
    expect(w.stripe.invoiceFinalized).toEqual([]);
    expect(w.stripe.invoicePaid).toEqual([]);
    expect(w.stripe.deletedInvoices).toEqual(["in_test_1"]);
    expect(await status(w.db, "bookings", bookingId)).toBe("cancelled");
  });

  it("cancelling deletes the booking's draft invoices as well as voiding open ones", async () => {
    const { bookingId, items } = await planBooking(w);
    w.stripe.invoiceStatus.in_draft = "draft";
    await w.db.query("update payment_schedule_items set stripe_invoice_id = 'in_draft' where id = $1", [items[1].id]);
    await cancelBooking(w.db, w.stripe, bookingId, "refund", "guest", new Date("2027-05-31T02:00:00Z"), opts());
    expect(w.stripe.deletedInvoices).toEqual(["in_draft"]);
  });

  it("an invoice paid on a cancelled booking is refunded in full automatically, once, and Tanya is told", async () => {
    const { bookingId, items } = await planBooking(w);
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    w.stripe.invoicePaymentIntent.in_evt_p = "pi_late";
    await handleStripeEvent(invoiceEvent("evt_p", "invoice.paid", items[1].id, bookingId), w.deps);
    // A second delivery of the same payment under another event id (or after the 24 h key window).
    await handleStripeEvent(invoiceEvent("evt_p2", "invoice.paid", items[1].id, bookingId, { id: "in_evt_p" }), w.deps);
    expect(w.stripe.refundsCreated).toEqual([
      {
        params: { payment_intent: "pi_late", amount: 192000, metadata: { kind: "inactive_invoice", booking_id: bookingId, invoice_id: "in_evt_p" } },
        options: { idempotencyKey: "efzin-inactive-invoice-refund-in_evt_p" },
      },
    ]);
    const rec = (await w.db.query<{ refund_id: string }>("select refund_id from invoice_refunds where invoice_id = 'in_evt_p'")).rows;
    expect(rec).toEqual([{ refund_id: "re_test_1" }]);
    const alerts = w.emails.filter((e) => e.kind === "admin_error");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data).toMatchObject({ context: "payment_on_inactive_booking_refunded", bookingId });
  });
});

describe("refunds and Ef Zin cancellations", () => {
  it("adopts a cancellation refund Stripe already has for the charge instead of refunding again", async () => {
    const b = await paidEvent(w);
    w.stripe.existingRefunds.push({
      id: "re_earlier",
      charge: "ch_layla@x.com",
      amount: 26900,
      status: "succeeded",
      metadata: { kind: "cancellation", booking_id: b.bookingId },
    });
    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", daysBefore(EVENT_START, 3), opts());
    expect(w.stripe.refundsCreated).toEqual([]);
    const row = (await w.db.query<{ refund_id: string }>("select refund_id from booking_refunds")).rows[0];
    expect(row.refund_id).toBe("re_earlier");
  });

  it("--send goes on after a booking fails, and reports the failure", async () => {
    const a = await paidEvent(w, "layla@x.com");
    const b = await paidEvent(w, "omar@x.com");
    const list = w.stripe.charges.list;
    w.stripe.charges.list = async (p) => {
      if (p.payment_intent === "pi_layla@x.com") throw new Error("stripe down");
      return list(p);
    };
    const r = await runCancelExperience(w.db, w.stripe, "test-event", "send", {
      now: daysBefore(EVENT_START, 3),
      ...opts(),
      outDir: mkdtempSync(join(tmpdir(), "efzin-cancel-")),
    });
    expect(r.failures).toEqual([{ bookingId: a.bookingId, error: "stripe down" }]);
    expect(await status(w.db, "bookings", a.bookingId)).toBe("paid");
    expect(await status(w.db, "bookings", b.bookingId)).toBe("refunded");
    expect(w.emails.filter((e) => e.kind === "admin_error").map((e) => e.data.context)).toContain("cancel_experience_failed");
  });

  it("retreat 30–60 days out paid above half: money back, gift part first, then the card in proportion minus fees", async () => {
    const b = await retreatPlan(w, true);
    // The second instalment (72000) was paid too: 168000 paid incl. the 30000 gift.
    await w.db.query("update payment_schedule_items set status = 'paid', stripe_invoice_id = 'in_r2' where id = $1", [b.itemIds[2]]);
    await w.db.query("update bookings set amount_paid_base_minor = 168000 where id = $1", [b.bookingId]);
    w.stripe.invoicePaymentIntent.in_r2 = "pi_inst2";
    w.stripe.addCharge({ id: "ch_inst2", paymentIntent: "pi_inst2", amount: 72000, currency: "eur", fee: 6000, exchangeRate: 4, created: 1_800_200_000 });
    const before = await giftBalance(w.db, b.cardId!);
    // 168000 − 120000 = 48000 back: 30000 gift, 18000 of 138000 card-paid across the charges.
    const out = await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", daysBefore(RETREAT_START, 45), opts());
    expect(out.plan!.toGiftCardAed).toBe(120000);
    expect(refunds(w)).toEqual([
      { charge: "ch_inst2", amount: 9391 - 1500 },
      { charge: "ch_inst", amount: 6261 - 1500 },
      { charge: "ch_dep", amount: 2348 - 600 },
    ]);
    expect(await giftBalance(w.db, b.cardId!)).toBe(before + 120000);
  });

  it("when the booker cancels, the other guests are told their place is cancelled", async () => {
    const b = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com" }]);
    await cancelBooking(w.db, w.stripe, b.bookingId, "credit", "guest", daysBefore(EVENT_START, 3), opts());
    const mails = w.emails.filter((e) => e.kind === "booking_cancelled");
    expect(mails.map((e) => e.to).sort()).toEqual(["layla@x.com", "sara@x.com"]);
    expect(mails.find((e) => e.to === "sara@x.com")!.data).toMatchObject({ forGuest: true, bookerName: "Layla H" });
    expect(mails.find((e) => e.to === "sara@x.com")!.data).not.toHaveProperty("creditCode");
  });
});

describe("transfer limit", () => {
  it("a booking's places can be transferred at most 3 times", async () => {
    const b = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com" }]);
    const g = (await w.db.query<{ id: string }>("select id from booking_guests where booking_id = $1 and not is_booker", [b.bookingId])).rows[0].id;
    const now = hoursBefore(EVENT_START, 30);
    const fx = { byPersonId: b.bookerId, sendEmail: w.deps.sendEmail, origin: ORIGIN };
    for (const n of [1, 2, 3]) await transferSpot(w.db, g, { name: `N${n}`, email: `n${n}@x.com` }, now, fx);
    await expect(transferSpot(w.db, g, { name: "N4", email: "n4@x.com" }, now, fx)).rejects.toMatchObject({ code: "limit" });
  });
});
