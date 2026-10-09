import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUnrefunded } from "../../lib/admin/payments";
import { runDaily, type DailyDeps } from "../../lib/cron/daily";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { startPayRest } from "../../lib/stripe/selfServe";
import { captureEmails, type Captured } from "./cronFixtures";
import { ORIGIN, event, invoiceEvent, planBooking, world, type World } from "./webhookFixtures";

/** 06:00 in Dubai on the given date (the daily cron's time). */
const at = (ymd: string) => new Date(`${ymd}T02:00:00Z`);

let w: World;
let sent: Captured[];
let restore: () => void;
let deps: DailyDeps;

beforeEach(async () => {
  w = await world();
  const c = captureEmails();
  sent = c.sent;
  restore = c.restore;
  deps = { stripe: w.stripe, sendEmail: c.send, origin: ORIGIN };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

const refundIdOf = async (sql: string, id: string) => (await w.db.query<{ r: string | null }>(sql, [id])).rows[0].r;

describe("payment on a cancelled booking whose automatic refund failed", () => {
  async function failedInvoiceRefund() {
    const { bookingId, items } = await planBooking(w);
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    w.stripe.invoicePaymentIntent.in_evt_p = "pi_late";
    w.stripe.refundError = Object.assign(new Error("stripe down"), { statusCode: 500 });
    await handleStripeEvent(invoiceEvent("evt_p", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await refundIdOf("select refund_id as r from invoice_refunds where invoice_id = $1", "in_evt_p")).toBeNull();
    return bookingId;
  }

  it("is listed on /admin/payments with the booking and the guest's contact until refunded", async () => {
    const bookingId = await failedInvoiceRefund();
    expect(await loadUnrefunded(w.db)).toEqual([
      expect.objectContaining({
        kind: "inactive_invoice",
        ref: "in_evt_p",
        bookingId,
        title: "Test Retreat",
        amountMinor: 192000,
        currency: "EUR",
        bookerName: "Layla Haddad",
        bookerEmail: "layla@email.com",
        bookerPhone: "+971500000000",
      }),
    ]);
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(await loadUnrefunded(w.db)).toEqual([]);
  });

  it("the daily job retries it once with the same idempotency key, stores the refund and never refunds again", async () => {
    await failedInvoiceRefund();
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(w.stripe.refundsCreated).toHaveLength(1);
    expect(w.stripe.refundsCreated[0]).toMatchObject({
      params: { payment_intent: "pi_late", amount: 192000, metadata: { kind: "inactive_invoice", invoice_id: "in_evt_p" } },
      options: { idempotencyKey: "efzin-inactive-invoice-refund-in_evt_p" },
    });
    expect(await refundIdOf("select refund_id as r from invoice_refunds where invoice_id = $1", "in_evt_p")).toBe("re_test_1");
    await runDaily(w.db, at("2027-03-11"), deps);
    expect(w.stripe.refundsCreated).toHaveLength(1);
  });

  it("the guest is told about the refund once it goes through on the retry, exactly once", async () => {
    await failedInvoiceRefund();
    expect(w.emails.filter((e) => e.kind === "payment_refunded")).toEqual([]);
    await runDaily(w.db, at("2027-03-10"), deps);
    const notes = sent.filter((s) => s.kind === "payment_refunded");
    expect(notes.map((s) => s.to)).toEqual(["layla@email.com"]);
    expect(notes[0].subject).toBe("We've refunded your payment of €1,920");
    await runDaily(w.db, at("2027-03-11"), deps);
    expect(sent.filter((s) => s.kind === "payment_refunded")).toHaveLength(1);
  });

  it("adopts a refund Stripe already made (our metadata) instead of refunding twice", async () => {
    const bookingId = await failedInvoiceRefund();
    w.stripe.existingRefunds.push({
      id: "re_earlier",
      charge: "ch_late",
      amount: 192000,
      status: "succeeded",
      metadata: { kind: "inactive_invoice", booking_id: bookingId, invoice_id: "in_evt_p" },
    });
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await refundIdOf("select refund_id as r from invoice_refunds where invoice_id = $1", "in_evt_p")).toBe("re_earlier");
  });
});

describe("guest notice of an automatic refund", () => {
  it("a payment on a cancelled booking refunded at once: the guest gets a short note (ref = refund id)", async () => {
    const { bookingId, items } = await planBooking(w);
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    w.stripe.invoicePaymentIntent.in_evt_p = "pi_late";
    // The real mailer (email_log dedupe), as in production.
    const calls: { kind: string; to: string; data: Record<string, unknown>; opts: unknown }[] = [];
    const send = deps.sendEmail;
    const d = {
      ...w.deps,
      sendEmail: async (...a: Parameters<typeof send>) => {
        calls.push({ kind: a[0], to: a[1], data: a[2], opts: a[4] });
        return send(...a);
      },
    };
    await handleStripeEvent(invoiceEvent("evt_p", "invoice.paid", items[1].id, bookingId), d);
    const notes = calls.filter((e) => e.kind === "payment_refunded");
    expect(notes).toEqual([
      {
        kind: "payment_refunded",
        to: "layla@email.com",
        data: expect.objectContaining({ name: "Layla Haddad", experience: "Test Retreat", amountMinor: 192000, currency: "EUR", reason: "inactive_invoice" }),
        opts: { ref: "re_test_1", db: w.db },
      },
    ]);
    expect(sent.filter((s) => s.kind === "payment_refunded")).toHaveLength(1);
    // The daily job does not send it again.
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(sent.filter((s) => s.kind === "payment_refunded")).toHaveLength(1);
  });

  it("a pay-rest excess refunded at once: the guest is told the amount given back", async () => {
    const { bookingId, items } = await planBooking(w, "instalments");
    const booker = (await w.db.query<{ id: string }>("select booker_person_id as id from bookings")).rows[0].id;
    w.stripe.sessions.length = 0;
    await startPayRest({ db: w.db, stripe: w.stripe, origin: ORIGIN }, bookingId, booker);
    const s = w.stripe.sessions[0];
    await handleStripeEvent(
      invoiceEvent("evt_inv", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    await handleStripeEvent(
      event("evt_rest", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_rest_1",
        mode: "payment",
        payment_status: "paid",
        metadata: s.metadata,
        amount_total: s.line_items![0].price_data!.unit_amount,
        currency: "eur",
        payment_intent: "pi_rest_1",
      }),
      w.deps,
    );
    const notes = w.emails.filter((e) => e.kind === "payment_refunded");
    expect(notes.map((e) => [e.to, e.data.amountMinor, e.data.currency, e.data.reason])).toEqual([
      ["layla@email.com", items[1].amount_minor, "EUR", "pay_rest_excess"],
    ]);
  });
});

describe("pay-rest excess whose automatic refund failed", () => {
  async function failedExcessRefund() {
    const { bookingId, items } = await planBooking(w, "instalments");
    const booker = (await w.db.query<{ id: string }>("select booker_person_id as id from bookings")).rows[0].id;
    w.stripe.sessions.length = 0;
    await startPayRest({ db: w.db, stripe: w.stripe, origin: ORIGIN }, bookingId, booker);
    const s = w.stripe.sessions[w.stripe.sessions.length - 1];
    const evt = event("evt_rest", "checkout.session.completed", {
      object: "checkout.session",
      id: "cs_rest_1",
      mode: "payment",
      payment_status: "paid",
      metadata: s.metadata,
      amount_total: s.line_items![0].price_data!.unit_amount,
      currency: "eur",
      payment_intent: "pi_rest_1",
    });
    await handleStripeEvent(
      invoiceEvent("evt_inv", "invoice.paid", items[1].id, bookingId, { amount_paid: items[1].amount_minor }),
      w.deps,
    );
    w.stripe.refundError = Object.assign(new Error("stripe down"), { statusCode: 500 });
    await handleStripeEvent(evt, w.deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    return { bookingId, excess: items[1].amount_minor };
  }

  it("is listed, then retried by the daily job once, with metadata for adoption", async () => {
    const { bookingId, excess } = await failedExcessRefund();
    expect(await loadUnrefunded(w.db)).toEqual([
      expect.objectContaining({ kind: "pay_rest_excess", ref: "cs_rest_1", bookingId, amountMinor: excess, currency: "EUR", bookerEmail: "layla@email.com" }),
    ]);
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(w.stripe.refundsCreated).toEqual([
      {
        params: { payment_intent: "pi_rest_1", amount: excess, metadata: { kind: "pay_rest_excess", booking_id: bookingId, session_id: "cs_rest_1" } },
        options: { idempotencyKey: "efzin-payrest-refund-cs_rest_1" },
      },
    ]);
    expect(await refundIdOf("select refund_id as r from pay_rest_settlements where session_id = $1", "cs_rest_1")).toBe("re_test_1");
    expect(await loadUnrefunded(w.db)).toEqual([]);
    await runDaily(w.db, at("2027-03-11"), deps);
    expect(w.stripe.refundsCreated).toHaveLength(1);
  });

  it("adopts an earlier pay-rest refund instead of refunding twice", async () => {
    const { bookingId, excess } = await failedExcessRefund();
    w.stripe.existingRefunds.push({
      id: "re_rest_earlier",
      charge: "ch_rest",
      amount: excess,
      status: "succeeded",
      metadata: { kind: "pay_rest_excess", booking_id: bookingId, session_id: "cs_rest_1" },
    });
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await refundIdOf("select refund_id as r from pay_rest_settlements where session_id = $1", "cs_rest_1")).toBe("re_rest_earlier");
  });
});
