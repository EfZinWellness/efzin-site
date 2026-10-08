import { describe, it, expect, beforeEach } from "vitest";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { confirmPendingBooking } from "../../lib/booking/confirm";
import { releaseCancelledCheckout } from "../../lib/booking/cancelReturn";
import {
  EVENT,
  NOW,
  RETREAT,
  checkout,
  completedBooking,
  count,
  credit,
  event,
  giftCard,
  world,
  type World,
} from "./webhookFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
});

const kinds = () => w.emails.map((e) => e.kind).sort();

/** Retreat for two on monthly payments, part paid by an AED 100 gift card. */
async function retreatPlan() {
  const code = await giftCard(w.db, 10000);
  return checkout(w, RETREAT, {
    lines: [{ ticketKey: "shared", qty: 2 }],
    guests: [{ name: "Sara", email: "sara@email.com", ticketKey: "shared" }],
    paymentOption: "instalments",
    scheduleConsent: true,
    giftCode: code,
  });
}

describe("checkout.session.completed (booking)", () => {
  it("creates the booking, guests, people, schedule, redeems the gift and sends emails", async () => {
    const { pendingId, sessionId } = await retreatPlan();
    const out = await handleStripeEvent(
      completedBooking("evt_1", pendingId, sessionId, { customer: "cus_test_1" }),
      w.deps,
    );
    expect(out).toBe("processed");

    expect(await count(w.db, "select * from bookings")).toBe(1);
    const b = (await w.db.query<Record<string, unknown>>("select * from bookings")).rows[0];
    expect(b).toMatchObject({ status: "deposit_paid", amount_paid_minor: 9200, presentment_currency: "GBP" });
    expect(await count(w.db, "select * from booking_guests")).toBe(2);
    expect(await count(w.db, "select distinct person_id from booking_guests")).toBe(2);
    const items = await w.db.query<{ status: string }>("select status from payment_schedule_items order by seq");
    expect(items.rows.map((i) => i.status)).toEqual(["paid", "scheduled", "scheduled", "scheduled", "scheduled"]);
    expect(await count(w.db, "select * from holds where released_at is null")).toBe(0);
    expect(await count(w.db, "select * from gift_card_ledger where reason = 'redeem'")).toBe(1);

    expect(kinds()).toEqual(["admin_new_booking", "booking_confirmed", "guest_added"]);
    const confirmed = w.emails.find((e) => e.kind === "booking_confirmed")!;
    expect(confirmed.to).toBe("layla@email.com");
    expect(confirmed.data.claimLink).toContain("layla%40email.com");
    expect(confirmed.data.schedule).toHaveLength(5);
    expect(w.emails.find((e) => e.kind === "guest_added")!.to).toBe("sara@email.com");

    const linked = await w.db.query<{ email: string }>(
      "select email from people where auth_user_id is not null order by email",
    );
    expect(linked.rows.map((r) => r.email)).toEqual(["layla@email.com", "sara@email.com"]);
    // The card used for the deposit is kept as the default for later payments.
    expect(w.stripe.customerUpdates).toEqual([
      { id: "cus_test_1", params: { invoice_settings: { default_payment_method: `pm_of_pi_${sessionId}` } } },
    ]);
  });

  it("is idempotent: the same event twice makes one booking and one set of emails", async () => {
    const { pendingId, sessionId } = await retreatPlan();
    const evt = completedBooking("evt_1", pendingId, sessionId);
    await handleStripeEvent(evt, w.deps);
    expect(await handleStripeEvent(evt, w.deps)).toBe("duplicate");
    expect(await count(w.db, "select * from bookings")).toBe(1);
    expect(w.emails).toHaveLength(3);
  });

  it("saves the SetupIntent card as the customer default in setup mode", async () => {
    const code = await giftCard(w.db, 200000);
    const { pendingId, sessionId } = await checkout(w, RETREAT, {
      lines: [{ ticketKey: "shared", qty: 1 }],
      paymentOption: "instalments",
      scheduleConsent: true,
      giftCode: code,
    });
    await handleStripeEvent(
      completedBooking("evt_s", pendingId, sessionId, {
        mode: "setup",
        payment_status: "no_payment_required",
        amount_total: null,
        currency: null,
        payment_intent: null,
        setup_intent: "seti_1",
        customer: "cus_test_1",
      }),
      w.deps,
    );
    const b = (await w.db.query<Record<string, unknown>>("select * from bookings")).rows[0];
    expect(b).toMatchObject({ status: "deposit_paid", amount_paid_minor: 0, stripe_payment_intent: null });
    expect(w.stripe.customerUpdates[0]).toEqual({
      id: "cus_test_1",
      params: { invoice_settings: { default_payment_method: "pm_of_seti_1" } },
    });
  });

  it("rolls back the event record when handling fails, so a retry re-processes it", async () => {
    const { pendingId, sessionId } = await retreatPlan();
    w.stripe.customerUpdateError = new Error("stripe down");
    const evt = completedBooking("evt_r", pendingId, sessionId, { customer: "cus_test_1" });
    await expect(handleStripeEvent(evt, w.deps)).rejects.toThrow("stripe down");
    expect(await count(w.db, "select * from stripe_events")).toBe(0);
    w.stripe.customerUpdateError = null;
    expect(await handleStripeEvent(evt, w.deps)).toBe("processed");
    expect(await count(w.db, "select * from bookings")).toBe(1);
    expect(w.stripe.customerUpdates).toHaveLength(1);
    // Emails went out with the first (committed) confirmation and are not repeated.
    expect(w.emails.filter((e) => e.kind === "booking_confirmed")).toHaveLength(1);
  });

  it("credit claim lost: confirms without it, moves the amount to a new item and emails Tanya", async () => {
    const code = await credit(w.db, 10000);
    const first = await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], creditCode: code });
    const later = new Date(NOW.getTime() + 32 * 60_000);
    await checkout(
      w,
      EVENT,
      {
        lines: [{ ticketKey: "whole", qty: 1 }],
        creditCode: code,
        booker: { name: "B", email: "b@example.com", phone: "+971500000001" },
      },
      later,
    );
    await handleStripeEvent(
      completedBooking("evt_c", first.pendingId, first.sessionId, { amount_total: 18000, currency: "aed" }),
      w.deps,
    );
    const b = (
      await w.db.query<Record<string, unknown>>(
        "select * from bookings where booker_person_id = (select id from people where email = 'layla@email.com')",
      )
    ).rows[0];
    expect(b).toMatchObject({
      status: "deposit_paid",
      credit_applied_aed_minor: 0,
      amount_aed_minor: 18000,
      amount_paid_base_minor: 18000,
    });
    const items = await w.db.query<{ seq: number; status: string; amount_minor: number; due_on: string }>(
      "select seq, status, amount_minor, to_char(due_on, 'YYYY-MM-DD') due_on from payment_schedule_items order by seq",
    );
    expect(items.rows).toEqual([
      { seq: 0, status: "paid", amount_minor: 18000, due_on: "2027-01-10" },
      { seq: 1, status: "scheduled", amount_minor: 10000, due_on: "2027-01-22" },
    ]);
    const alert = w.emails.find((e) => e.kind === "admin_error");
    expect(alert?.data.context).toBe("credit_claim_lost");
  });

  it("gift redeem fails on a late payment: confirms with gift 0, flags it and emails Tanya", async () => {
    const code = await giftCard(w.db, 10000);
    const { pendingId, sessionId } = await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: code });
    await w.db.query("update gift_cards set status = 'void'");
    await handleStripeEvent(
      completedBooking("evt_g", pendingId, sessionId, { amount_total: 18000, currency: "aed" }),
      w.deps,
    );
    const b = (await w.db.query<Record<string, unknown> & { policy_snapshot: Record<string, unknown> }>("select * from bookings"))
      .rows[0];
    expect(b).toMatchObject({ status: "deposit_paid", gift_card_applied_aed_minor: 0, amount_aed_minor: 18000 });
    expect(b.policy_snapshot.gift_claim_lost).toBe(true);
    const items = await w.db.query<{ amount_minor: number }>("select amount_minor from payment_schedule_items order by seq");
    expect(items.rows.map((i) => i.amount_minor)).toEqual([18000, 10000]);
    expect(await count(w.db, "select * from gift_card_ledger where reason = 'redeem'")).toBe(0);
    expect(await count(w.db, "select * from gift_card_reservations where released_at is null")).toBe(0);
    expect(w.emails.find((e) => e.kind === "admin_error")?.data.context).toBe("gift_claim_lost");
  });

  it("adds a lost amount to the last unpaid item of a plan", async () => {
    const code = await credit(w.db, 10000);
    const { pendingId, sessionId } = await checkout(w, RETREAT, {
      lines: [{ ticketKey: "shared", qty: 1 }],
      paymentOption: "deposit_balance",
      scheduleConsent: true,
      creditCode: code,
    });
    await w.db.query("update credits set claimed_pending_id = null");
    await handleStripeEvent(completedBooking("evt_p", pendingId, sessionId), w.deps);
    const items = await w.db.query<{ amount_minor: number }>("select amount_minor from payment_schedule_items order by seq");
    const payload = (
      await w.db.query<{ payload: { allocation: { schedule: { amountMinor: number }[]; creditUsedBaseMinor: number } } }>(
        "select payload from pending_bookings",
      )
    ).rows[0].payload;
    expect(items.rows.map((i) => i.amount_minor)).toEqual([
      payload.allocation.schedule[0].amountMinor,
      payload.allocation.schedule[1].amountMinor + payload.allocation.creditUsedBaseMinor,
    ]);
  });

  it("oversold after a late payment: still confirms and emails Tanya", async () => {
    const a = await checkout(w, EVENT, { lines: [{ ticketKey: "small", qty: 1 }] });
    await w.db.query("update holds set released_at = now()"); // A's hold lapsed and was swept
    const bPending = await checkout(w, EVENT, {
      lines: [{ ticketKey: "small", qty: 1 }],
      booker: { name: "B", email: "b@example.com", phone: "+971500000001" },
    });
    await confirmPendingBooking(w.db, bPending.pendingId, { amountPaidMinor: 15000, presentmentCurrency: "aed" });
    await handleStripeEvent(completedBooking("evt_o", a.pendingId, a.sessionId), w.deps);
    expect(await count(w.db, "select * from bookings")).toBe(2);
    expect(w.emails.find((e) => e.kind === "admin_error")?.data.context).toBe("oversold");
  });
});

describe("checkout.session.expired", () => {
  const expired = (id: string, pendingId: string, sessionId: string) =>
    event(id, "checkout.session.expired", {
      object: "checkout.session",
      id: sessionId,
      status: "expired",
      metadata: { kind: "booking", pending_booking_id: pendingId },
    });

  it("releases holds, gift value and credit claim and sends abandoned_checkout once", async () => {
    const gift = await giftCard(w.db, 10000);
    const code = await credit(w.db, 5000);
    const { pendingId, sessionId } = await checkout(w, EVENT, {
      lines: [{ ticketKey: "whole", qty: 1 }],
      giftCode: gift,
      creditCode: code,
    });
    await handleStripeEvent(expired("evt_e1", pendingId, sessionId), w.deps);
    expect(await count(w.db, "select * from holds where released_at is null")).toBe(0);
    expect(await count(w.db, "select * from gift_card_reservations where released_at is null")).toBe(0);
    expect(await count(w.db, "select * from credits where claimed_pending_id is not null")).toBe(0);
    expect(w.emails).toHaveLength(1);
    expect(w.emails[0]).toMatchObject({ kind: "abandoned_checkout", to: "layla@email.com" });
    expect(w.emails[0].data.link).toBe("https://efzin.test/book/test-event");

    await handleStripeEvent(expired("evt_e2", pendingId, sessionId), w.deps);
    expect(w.emails).toHaveLength(1);
  });

  it("after completed: nothing is released and no abandoned email", async () => {
    const { pendingId, sessionId } = await retreatPlan();
    await handleStripeEvent(completedBooking("evt_1", pendingId, sessionId), w.deps);
    const before = await count(w.db, "select * from gift_card_ledger");
    w.emails.length = 0;
    await handleStripeEvent(expired("evt_2", pendingId, sessionId), w.deps);
    expect(await count(w.db, "select * from gift_card_ledger")).toBe(before);
    expect(await count(w.db, "select * from gift_card_reservations where redeemed_booking_id is not null")).toBe(1);
    expect(w.emails).toEqual([]);
  });
});

describe("cancel return", () => {
  it("expires the open session and releases the pending booking", async () => {
    const gift = await giftCard(w.db, 10000);
    const { pendingId, sessionId } = await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: gift });
    expect(await releaseCancelledCheckout(w.db, w.stripe, pendingId)).toBe("released");
    expect(w.stripe.expired).toEqual([sessionId]);
    expect(await count(w.db, "select * from holds where released_at is null")).toBe(0);
    expect(await count(w.db, "select * from gift_card_reservations where released_at is null")).toBe(0);
    // The expired webhook that follows sends no "still waiting" email: the guest is on the page.
    await handleStripeEvent(
      event("evt_x", "checkout.session.expired", {
        object: "checkout.session",
        id: sessionId,
        metadata: { kind: "booking", pending_booking_id: pendingId },
      }),
      w.deps,
    );
    expect(w.emails).toEqual([]);
  });

  it("leaves completed or confirmed checkouts alone", async () => {
    const { pendingId, sessionId } = await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }] });
    w.stripe.sessionStatus[sessionId] = "complete";
    expect(await releaseCancelledCheckout(w.db, w.stripe, pendingId)).toBe("ignored");
    expect(await count(w.db, "select * from holds where released_at is null")).toBe(1);

    await confirmPendingBooking(w.db, pendingId, { amountPaidMinor: 28000, presentmentCurrency: "aed" });
    w.stripe.sessionStatus[sessionId] = "expired";
    expect(await releaseCancelledCheckout(w.db, w.stripe, pendingId)).toBe("ignored");
    expect(await releaseCancelledCheckout(w.db, w.stripe, "not-a-uuid")).toBe("ignored");
    expect(w.stripe.expired).toEqual([]);
  });
});
