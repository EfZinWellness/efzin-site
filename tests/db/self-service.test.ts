import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancelError, cancelBooking, previewCancellation } from "../../lib/booking/cancel";
import { startPayRest } from "../../lib/stripe/selfServe";
import { ORIGIN, world, type World } from "./webhookFixtures";
import {
  EVENT_START,
  RETREAT_START,
  booking,
  daysBefore,
  giftBalance,
  giftCardId,
  hoursBefore,
  paidEvent,
  refunds,
  retreatPlan,
  spots,
  status,
} from "./selfServiceFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const opts = () => ({ sendEmail: w.deps.sendEmail, origin: ORIGIN });
const refundRows = async (bookingId: string) =>
  (
    await w.db.query<{ charge_id: string; amount_minor: number; refund_id: string | null }>(
      "select charge_id, amount_minor, refund_id from booking_refunds where booking_id = $1 order by amount_minor desc",
      [bookingId],
    )
  ).rows;

describe("event cancellations", () => {
  it("3 days out, refund: the card gets amount minus the Stripe fee, exactly as previewed", async () => {
    const b = await paidEvent(w);
    const now = daysBefore(EVENT_START, 3);
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "refund", now);
    expect(preview.options.map((o) => o.kind)).toEqual(["refund", "credit", "transfer"]);
    expect(preview.toCardByCharge).toEqual([{ chargeId: "ch_layla@x.com", amountMinor: 26900, currency: "AED", feeMinor: 1100 }]);
    expect(preview.feesDeductedMinor).toBe(1100);
    expect(await spots(w.db, b.ticketId)).toBe(0);

    const out = await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    expect(out.status).toBe("refunded");
    expect(refunds(w)).toEqual(preview.toCardByCharge.map((c) => ({ charge: c.chargeId, amount: c.amountMinor })));
    expect(w.stripe.refundsCreated[0].options).toEqual({ idempotencyKey: `efzin-cancel-${b.bookingId}-ch_layla@x.com` });
    expect(await refundRows(b.bookingId)).toEqual([{ charge_id: "ch_layla@x.com", amount_minor: 26900, refund_id: "re_test_1" }]);
    expect(await status(w.db, "bookings", b.bookingId)).toBe("refunded");
    expect(await spots(w.db, b.ticketId)).toBe(1);
    const row = (await w.db.query<{ cancelled_by: string; cancelled_at: string }>("select cancelled_by, cancelled_at from bookings")).rows[0];
    expect(row.cancelled_by).toBe("guest");
    expect(row.cancelled_at).not.toBeNull();
    expect(w.emails.map((e) => `${e.kind}>${e.to}`)).toContain("booking_cancelled>layla@x.com");
  });

  it("converts each charge's fee to the charge currency with the balance transaction's exchange rate", async () => {
    const b = await booking(
      w,
      { slug: "test-event", booker: { name: "Gus G", email: "gus@x.com" }, items: [{ seq: 0, dueOn: "2027-01-10", amount: 28000, status: "paid" }] },
      { paymentIntent: "pi_gbp" },
    );
    // Paid GBP 60.00 (Adaptive Pricing); fee AED 3.00 at 4.6 AED per GBP → GBP 0.65.
    w.stripe.addCharge({ id: "ch_gbp", paymentIntent: "pi_gbp", amount: 6000, currency: "gbp", fee: 300, exchangeRate: 4.6, created: 1 });
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "refund", daysBefore(EVENT_START, 3));
    expect(preview.toCardByCharge).toEqual([{ chargeId: "ch_gbp", amountMinor: 5935, currency: "GBP", feeMinor: 65 }]);
  });

  it("credit choice: the whole paid amount (card and gift) becomes AED credit for 12 months, nothing refunded", async () => {
    const cardId = await giftCardId(w.db, 20000);
    const b = await booking(
      w,
      { slug: "test-event", booker: { name: "Mia M", email: "mia@x.com" }, items: [{ seq: 0, dueOn: "2027-01-10", amount: 18000, status: "paid" }] },
      { paymentIntent: "pi_mia", paidBase: 28000, amountAed: 28000, gift: { cardId, aed: 10000, base: 10000 } },
    );
    const now = daysBefore(EVENT_START, 3);
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "credit", now);
    expect(preview).toMatchObject({ toCreditAed: 28000, toGiftCardAed: 0, toCardByCharge: [] });

    const out = await cancelBooking(w.db, w.stripe, b.bookingId, "credit", "guest", now, opts());
    expect(out.status).toBe("credited");
    const c = (
      await w.db.query<{ amount_aed_minor: number; expires_at: Date; person_id: string; source_booking_id: string }>(
        "select amount_aed_minor, expires_at, person_id, source_booking_id from credits",
      )
    ).rows;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ amount_aed_minor: 28000, person_id: b.bookerId, source_booking_id: b.bookingId });
    expect(new Date(c[0].expires_at).toISOString()).toBe("2028-01-29T06:00:00.000Z");
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await giftBalance(w.db, cardId)).toBe(10000);
    expect(await status(w.db, "bookings", b.bookingId)).toBe("credited");
  });

  it("1 day before: no refund option; a refund request cannot get money back", async () => {
    const b = await paidEvent(w);
    const now = daysBefore(EVENT_START, 1);
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "credit", now);
    expect(preview.options.map((o) => o.kind)).toEqual(["credit", "transfer"]);
    await expect(previewCancellation(w.db, w.stripe, b.bookingId, "refund", now)).rejects.toMatchObject({ code: "not_allowed" });
    await expect(cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts())).rejects.toMatchObject({ code: "not_allowed" });
    expect(await status(w.db, "bookings", b.bookingId)).toBe("paid");
  });

  it("only the booker can cancel, and a stale preview (amounts changed) is refused with nothing changed", async () => {
    const b = await paidEvent(w);
    const now = daysBefore(EVENT_START, 3);
    const other = (await w.db.query<{ id: string }>("insert into people (name, email) values ('X', 'x@x.com') returning id")).rows[0].id;
    await expect(
      cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, { ...opts(), byPersonId: other }),
    ).rejects.toBeInstanceOf(CancelError);
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "refund", now);
    // Two days later the refund band has closed.
    await expect(
      cancelBooking(w.db, w.stripe, b.bookingId, "credit", "guest", daysBefore(EVENT_START, 1), {
        ...opts(),
        byPersonId: b.bookerId,
        expectedFingerprint: preview.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "changed" });
    expect(await status(w.db, "bookings", b.bookingId)).toBe("paid");
    expect(w.stripe.refundsCreated).toEqual([]);
  });

  it("a refund that fails is recorded and finished by the next attempt, never twice", async () => {
    const b = await paidEvent(w);
    const now = daysBefore(EVENT_START, 3);
    w.stripe.refundError = Object.assign(new Error("api down"), { type: "StripeAPIError", statusCode: 500 });
    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    expect(await status(w.db, "bookings", b.bookingId)).toBe("refunded");
    expect(await refundRows(b.bookingId)).toEqual([{ charge_id: "ch_layla@x.com", amount_minor: 26900, refund_id: null }]);
    expect(w.emails.filter((e) => e.kind === "admin_error")).toHaveLength(1);

    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    expect(refunds(w)).toEqual([{ charge: "ch_layla@x.com", amount: 26900 }]);
    expect((await refundRows(b.bookingId))[0].refund_id).toBe("re_test_1");
  });
});

describe("retreat cancellations on a payment plan", () => {
  it("45 days out, 96000 paid of 240000: no money back, future items cancelled, invoices voided, pay-rest expired, nothing charged", async () => {
    const b = await retreatPlan(w, false);
    w.stripe.invoiceStatus.in_open = "open";
    await w.db.query("update payment_schedule_items set stripe_invoice_id = 'in_open' where id = $1", [b.itemIds[2]]);
    await startPayRest({ db: w.db, stripe: w.stripe, origin: ORIGIN, now: daysBefore(RETREAT_START, 46) }, b.bookingId, b.bookerId);
    const now = daysBefore(RETREAT_START, 45);

    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "refund", now);
    expect(preview.options.map((o) => o.kind)).toEqual(["transfer"]);
    expect(preview).toMatchObject({ toCardByCharge: [], toGiftCardAed: 0, toCreditAed: 0 });

    const out = await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    expect(out.status).toBe("cancelled");
    expect(await status(w.db, "payment_schedule_items", b.itemIds[2])).toBe("cancelled");
    expect(await status(w.db, "payment_schedule_items", b.itemIds[3])).toBe("cancelled");
    expect(await status(w.db, "payment_schedule_items", b.itemIds[1])).toBe("paid");
    expect(w.stripe.voided).toEqual(["in_open"]);
    expect(w.stripe.expired).toEqual(["cs_test_1"]);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.stripe.invoicesCreated).toEqual([]);
    expect(w.stripe.invoicePaid).toEqual([]);
    expect(await spots(w.db, b.ticketId)).toBe(10);
  });

  it("70 days out, 96000 paid incl. a 30000 gift: gift part back to the gift card, 66000 minus each charge's fee to the card, newest first", async () => {
    const b = await retreatPlan(w, true);
    const now = daysBefore(RETREAT_START, 70);
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "refund", now);
    expect(preview.toGiftCardAed).toBe(120000);
    expect(preview.toCardByCharge).toEqual([
      { chargeId: "ch_inst", amountMinor: 46500, currency: "EUR", feeMinor: 1500 },
      { chargeId: "ch_dep", amountMinor: 17400, currency: "EUR", feeMinor: 600 },
    ]);
    expect(preview.feesDeductedMinor).toBe(2100);
    const before = await giftBalance(w.db, b.cardId!);

    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    expect(refunds(w)).toEqual([
      { charge: "ch_inst", amount: 46500 },
      { charge: "ch_dep", amount: 17400 },
    ]);
    expect(await giftBalance(w.db, b.cardId!)).toBe(before + 120000);
    expect(await w.db.query("select * from credits")).toMatchObject({ rows: [] });
    expect(await status(w.db, "bookings", b.bookingId)).toBe("refunded");
  });

  it("an expired gift card: that part becomes 12-month credit instead", async () => {
    const b = await retreatPlan(w, true);
    await w.db.query("update gift_cards set expires_at = '2027-03-01T00:00:00Z' where id = $1", [b.cardId]);
    await w.db.query("select expire_gift_cards('2027-03-02T00:00:00Z')");
    const now = daysBefore(RETREAT_START, 70);
    const preview = await previewCancellation(w.db, w.stripe, b.bookingId, "refund", now);
    expect(preview).toMatchObject({ toGiftCardAed: 0, toCreditAed: 120000 });

    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, opts());
    const c = (await w.db.query<{ amount_aed_minor: number; person_id: string }>("select amount_aed_minor, person_id from credits")).rows;
    expect(c).toEqual([{ amount_aed_minor: 120000, person_id: b.bookerId }]);
    expect(await giftBalance(w.db, b.cardId!)).toBe(0);
    expect(refunds(w).map((r) => r.amount)).toEqual([46500, 17400]);
  });

  it("Ef Zin cancels: gift part back to the gift card and every card payment refunded in full, no fee", async () => {
    const b = await retreatPlan(w, true);
    const now = daysBefore(RETREAT_START, 20);
    const out = await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "efzin", now, opts());
    expect(out.status).toBe("refunded");
    expect(refunds(w)).toEqual([
      { charge: "ch_inst", amount: 48000 },
      { charge: "ch_dep", amount: 18000 },
    ]);
    expect(await giftBalance(w.db, b.cardId!)).toBe(150000);
    const row = (await w.db.query<{ cancelled_by: string }>("select cancelled_by from bookings")).rows[0];
    expect(row.cancelled_by).toBe("efzin");
  });
});
