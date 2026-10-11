import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { ExperienceSchema, type Experience } from "../../lib/content/schema";
import { syncContent } from "../../lib/content/sync";
import { validateBooking, type BookingRequest } from "../../lib/booking/validate";
import { CodeError, SoldOutError } from "../../lib/booking/pending";
import { confirmPendingBooking } from "../../lib/booking/confirm";
import { startCheckout } from "../../lib/stripe/checkout";
import type { SqlClient } from "../../lib/content/sync";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { findUsableCredit, issueCredit } from "../../lib/credits/db";
import { handleCodeCheck, resetCodeThrottleForTests } from "../../lib/booking/codes";
import { handleCheckout } from "../../lib/booking/checkoutHandler";
import { FakeStripe } from "./fakeStripe";

const NOW = new Date("2027-01-10T09:00:00Z");
const RATES = { EUR: 0.92, USD: 1 };

function experience(over: Record<string, unknown>): Experience {
  return ExperienceSchema.parse({
    venue: { name: "Somewhere" },
    pillars: ["move"],
    status: "on_sale",
    heroImage: "/images/x.jpg",
    summary: "s",
    ...over,
  });
}

const EVENT = experience({
  slug: "test-event",
  type: "event",
  title: "Test Event",
  startsAt: "2027-02-01T10:00:00+04:00",
  endsAt: "2027-02-01T12:00:00+04:00",
  timezone: "Asia/Dubai",
  baseCurrency: "AED",
  policy: "standard_event",
  tickets: [
    { key: "whole", name: "Whole experience", priceMinor: 28000, capacity: 16 },
    { key: "small", name: "Contrast only", priceMinor: 15000, capacity: 1 },
  ],
});

const RETREAT = experience({
  slug: "test-retreat",
  type: "retreat",
  title: "Test Retreat",
  startsAt: "2027-06-10T10:00:00+03:00",
  endsAt: "2027-06-14T16:00:00+03:00",
  timezone: "Europe/Athens",
  baseCurrency: "EUR",
  policy: "standard_retreat",
  totalPriceMinor: 240000,
  tickets: [{ key: "shared", name: "Shared room", priceMinor: 240000, capacity: 10 }],
});

let db: PGlite;
let stripe: FakeStripe;

beforeEach(async () => {
  db = await freshDb();
  stripe = new FakeStripe();
  const r = await syncContent(db, [EVENT, RETREAT]);
  expect(r.errors).toEqual([]);
  resetCodeThrottleForTests();
});

function valid(exp: Experience, body: Record<string, unknown>): BookingRequest {
  const r = validateBooking(
    {
      slug: exp.slug,
      booker: { name: "Layla Haddad", email: "layla@email.com", phone: "+971500000000" },
      guests: [],
      paymentOption: "full",
      policyAccepted: true,
      ...body,
    },
    exp,
    NOW,
  );
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

const deps = (exp: Experience) => ({
  db,
  stripe,
  now: NOW,
  usdRates: RATES,
  origin: "https://efzin.test",
  experience: exp,
});

async function count(table: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n;
}

async function giftCard(aed: number): Promise<string> {
  const buyer = (
    await db.query<{ id: string }>("insert into people (name, email) values ('B', 'buyer@example.com') returning id")
  ).rows[0].id;
  const [c] = await issueGiftCards(db, {
    count: 1,
    initialAedMinor: aed,
    buyerPersonId: buyer,
    deliverOn: "2027-01-01",
    paymentRef: `pi_gift_${aed}`,
  });
  await activateGiftCards(db, `pi_gift_${aed}`, NOW);
  return c.code;
}

describe("startCheckout", () => {
  it("creates one hold per ticket line with the right quantities", async () => {
    const r = valid(EVENT, {
      lines: [
        { ticketKey: "whole", qty: 2 },
        { ticketKey: "small", qty: 1 },
      ],
      guests: [
        { name: "Sara", email: "sara@email.com", ticketKey: "whole" },
        { name: "Nour", email: "nour@email.com", ticketKey: "small" },
      ],
    });
    const out = await startCheckout(r, deps(EVENT));
    expect(out).toEqual({ kind: "redirect", url: "https://checkout.stripe.test/cs_test_1" });

    const holds = await db.query<{ key: string; qty: number; expires_at: string; checkout_session_id: string }>(
      `select tt.key, h.qty, h.expires_at, h.checkout_session_id
         from holds h join ticket_types tt on tt.id = h.ticket_type_id order by tt.key`,
    );
    expect(holds.rows.map((h) => [h.key, h.qty])).toEqual([
      ["small", 1],
      ["whole", 2],
    ]);
    const holdExpiry = new Date(holds.rows[0].expires_at).getTime();
    expect(holdExpiry).toBeGreaterThanOrEqual(NOW.getTime() + 31 * 60_000);
    expect(holdExpiry).toBeLessThan(NOW.getTime() + 32 * 60_000);
    expect(holds.rows[0].checkout_session_id).toBe("cs_test_1");

    const s = stripe.sessions[0];
    expect(s.mode).toBe("payment");
    // The session never outlives the holds.
    expect(s.expires_at).toBe(Math.floor(holdExpiry / 1000));
    expect(s.adaptive_pricing).toEqual({ enabled: true });
    // Card only (Apple Pay / Google Pay included): no delayed payment methods.
    expect(s.allowed_payment_method_types).toEqual(["card"]);
    expect(s.line_items?.[0].price_data?.unit_amount).toBe(28000 * 2 + 15000);
    expect(s.line_items?.[0].price_data?.currency).toBe("aed");
    expect(s.line_items?.[0].price_data?.product_data?.name).toBe("Test Event — Pay in full");
    // Pay in full, not signed in: no Stripe customer (nobody's saved cards can show), Checkout
    // collects the email; no save option.
    expect(s.customer).toBeUndefined();
    expect(s.customer_email).toBe("layla@email.com");
    expect(s.saved_payment_method_options).toBeUndefined();
    expect(s.payment_intent_data?.setup_future_usage).toBeUndefined();
    expect(stripe.customersCreated).toEqual([]);
    const pending = await db.query<{ id: string; kind: string; checkout_session_id: string; hold_ids: string[] }>(
      "select id, kind, checkout_session_id, hold_ids from pending_bookings",
    );
    expect(pending.rows[0]).toMatchObject({ kind: "booking", checkout_session_id: "cs_test_1" });
    expect(pending.rows[0].hold_ids).toHaveLength(2);
    expect(s.metadata).toEqual({ kind: "booking", pending_booking_id: pending.rows[0].id });
    expect(s.success_url).toBe("https://efzin.test/book/test-event/confirmed?session={CHECKOUT_SESSION_ID}");
    expect(s.cancel_url).toBe(`https://efzin.test/book/test-event?cancelled=${pending.rows[0].id}`);
    expect(s.after_expiration).toBeUndefined();
  });

  it("SoldOutError creates no Stripe session and no pending row", async () => {
    const r = valid(EVENT, {
      lines: [{ ticketKey: "small", qty: 2 }],
      guests: [{ name: "Sara", email: "sara@email.com", ticketKey: "small" }],
    });
    await expect(startCheckout(r, deps(EVENT))).rejects.toBeInstanceOf(SoldOutError);
    expect(stripe.sessions).toHaveLength(0);
    expect(await count("pending_bookings")).toBe(0);
    expect(await count("holds")).toBe(0);
  });

  it("deposit option charges seq 0 (48000) and saves the card", async () => {
    const r = valid(RETREAT, {
      lines: [{ ticketKey: "shared", qty: 1 }],
      paymentOption: "deposit_balance",
      scheduleConsent: true,
    });
    await startCheckout(r, deps(RETREAT));
    const s = stripe.sessions[0];
    expect(s.mode).toBe("payment");
    expect(s.line_items?.[0].price_data?.unit_amount).toBe(48000);
    expect(s.line_items?.[0].price_data?.currency).toBe("eur");
    expect(s.payment_intent_data?.setup_future_usage).toBe("off_session");
    // Not signed in: a fresh customer for this booking only (no saved cards to show), never
    // stored on the person; no redisplay.
    expect(s.customer).toBe("cus_test_1");
    expect(stripe.customersCreated).toEqual([
      expect.objectContaining({ email: "layla@email.com", metadata: expect.objectContaining({ pending_booking_id: expect.any(String) }) }),
    ]);
    expect(s.saved_payment_method_options).toBeUndefined();
    expect(s.allowed_payment_method_types).toEqual(["card"]);
    const p = await db.query<{ stripe_customer_id: string | null }>(
      "select stripe_customer_id from people where email = 'layla@email.com'",
    );
    expect(p.rows[0].stripe_customer_id).toBeNull();
    const payload = (await db.query<{ payload: { schedule: { amountMinor: number }[] } }>("select payload from pending_bookings"))
      .rows[0].payload;
    expect(payload.schedule.map((i) => i.amountMinor)).toEqual([48000, 192000]);
  });

  describe("saved cards only for the signed-in guest", () => {
    /** Layla already exists with a Stripe customer (and possibly saved cards). */
    const known = async () =>
      (
        await db.query<{ id: string }>(
          "insert into people (name, email, stripe_customer_id) values ('Layla Haddad', 'layla@email.com', 'cus_known') returning id",
        )
      ).rows[0].id;

    it("anonymous pay in full with someone's email: their customer is NOT attached, no redisplay", async () => {
      await known();
      await startCheckout(valid(EVENT, { lines: [{ ticketKey: "whole", qty: 1 }] }), deps(EVENT));
      const s = stripe.sessions[0];
      expect(s.customer).toBeUndefined();
      expect(s.customer_email).toBe("layla@email.com");
      expect(s.saved_payment_method_options).toBeUndefined();
    });

    it("anonymous plan with someone's email: a fresh customer, not theirs; no redisplay", async () => {
      await known();
      await startCheckout(
        valid(RETREAT, { lines: [{ ticketKey: "shared", qty: 1 }], paymentOption: "deposit_balance", scheduleConsent: true }),
        deps(RETREAT),
      );
      const s = stripe.sessions[0];
      expect(s.customer).toBe("cus_test_1");
      expect(s.customer).not.toBe("cus_known");
      expect(s.saved_payment_method_options).toBeUndefined();
      const p = await db.query<{ c: string }>("select stripe_customer_id as c from people where email = 'layla@email.com'");
      expect(p.rows[0].c).toBe("cus_known");
    });

    it("signed in as the booker: their customer is attached with save and saved cards", async () => {
      const id = await known();
      await startCheckout(valid(EVENT, { lines: [{ ticketKey: "whole", qty: 1 }] }), { ...deps(EVENT), signedInPersonId: id });
      const s = stripe.sessions[0];
      expect(s.customer).toBe("cus_known");
      expect(s.customer_email).toBeUndefined();
      expect(s.saved_payment_method_options).toEqual({ payment_method_save: "enabled", allow_redisplay_filters: ["always", "limited"] });
    });

    it("signed in as someone else: treated as anonymous", async () => {
      await known();
      const other = (await db.query<{ id: string }>("insert into people (name, email) values ('O', 'o@x.com') returning id")).rows[0].id;
      await startCheckout(valid(EVENT, { lines: [{ ticketKey: "whole", qty: 1 }] }), { ...deps(EVENT), signedInPersonId: other });
      expect(stripe.sessions[0].customer).toBeUndefined();
      expect(stripe.sessions[0].saved_payment_method_options).toBeUndefined();
    });

    it("signed-in plan: their own customer, saved cards offered", async () => {
      const id = await known();
      await startCheckout(
        valid(RETREAT, { lines: [{ ticketKey: "shared", qty: 1 }], paymentOption: "deposit_balance", scheduleConsent: true }),
        { ...deps(RETREAT), signedInPersonId: id },
      );
      const s = stripe.sessions[0];
      expect(s.customer).toBe("cus_known");
      expect(s.saved_payment_method_options).toEqual({ allow_redisplay_filters: ["always", "limited"] });
      expect(stripe.customersCreated).toEqual([]);
    });
  });

  it("uses setup mode when first payment is zero", async () => {
    const code = await giftCard(200000); // AED 2,000 ≈ EUR 501, more than the EUR 480 deposit
    const r = valid(RETREAT, {
      lines: [{ ticketKey: "shared", qty: 1 }],
      paymentOption: "instalments",
      scheduleConsent: true,
      giftCode: code,
    });
    const out = await startCheckout(r, deps(RETREAT));
    expect(out.kind).toBe("redirect");
    const s = stripe.sessions[0];
    expect(s.mode).toBe("setup");
    expect(s.allowed_payment_method_types).toEqual(["card"]);
    expect(s.customer).toBe("cus_test_1");
    expect(s.line_items).toBeUndefined();
    expect(s.metadata?.kind).toBe("booking");
    const res = await db.query<{ amount_aed_minor: number }>("select amount_aed_minor from gift_card_reservations");
    expect(res.rows[0].amount_aed_minor).toBe(200000);
  });

  it("confirms directly when fully covered", async () => {
    const code = await giftCard(50000);
    const r = valid(EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: code });
    const out = await startCheckout(r, deps(EVENT));
    expect(stripe.sessions).toHaveLength(0);
    expect(out.kind).toBe("confirmed");
    if (out.kind !== "confirmed") return;

    const b = await db.query<Record<string, unknown>>("select * from bookings where id = $1", [out.bookingId]);
    expect(b.rows[0]).toMatchObject({
      status: "paid",
      amount_paid_minor: 0,
      amount_paid_base_minor: 28000,
      amount_aed_minor: 28000,
      total_price_minor: 28000,
      gift_card_applied_aed_minor: 28000,
      payment_option: "full",
    });
    const ledger = await db.query<{ amount_aed_minor: number; reason: string }>(
      "select amount_aed_minor, reason from gift_card_ledger where reason = 'redeem'",
    );
    expect(ledger.rows).toEqual([{ amount_aed_minor: -28000, reason: "redeem" }]);
    expect(await count("booking_guests")).toBe(1);
    const items = await db.query<{ seq: number; status: string; amount_minor: number }>(
      "select seq, status, amount_minor from payment_schedule_items",
    );
    expect(items.rows).toEqual([{ seq: 0, status: "paid", amount_minor: 0 }]);
    const holds = await db.query<{ released_at: string | null }>("select released_at from holds");
    expect(holds.rows.every((h) => h.released_at !== null)).toBe(true);
  });

  it("covers a booking with a credit, and confirming twice returns the same booking", async () => {
    const owner = (
      await db.query<{ id: string }>("insert into people (name, email) values ('C', 'c@example.com') returning id")
    ).rows[0].id;
    const credit = await issueCredit(db, owner, 30000, null, NOW);
    const r = valid(EVENT, {
      lines: [{ ticketKey: "whole", qty: 1 }],
      creditCode: credit.code,
    });
    const out = await startCheckout(r, deps(EVENT));
    expect(out.kind).toBe("confirmed");
    if (out.kind !== "confirmed") return;
    const pendingId = (await db.query<{ id: string }>("select id from pending_bookings")).rows[0].id;
    expect(await confirmPendingBooking(db, pendingId, null)).toBe(out.bookingId);
    expect(await count("bookings")).toBe(1);
    const c = await db.query<{ redeemed_booking_id: string; amount_aed_minor: number }>(
      "select redeemed_booking_id, amount_aed_minor from credits order by amount_aed_minor desc",
    );
    expect(c.rows[0].redeemed_booking_id).toBe(out.bookingId);
    expect(c.rows[1].amount_aed_minor).toBe(2000); // leftover credit
  });

  it("confirmPendingBooking records a paid deposit and scheduled later items", async () => {
    const r = valid(RETREAT, {
      lines: [{ ticketKey: "shared", qty: 2 }],
      guests: [{ name: "Sara", email: "sara@email.com", ticketKey: "shared" }],
      paymentOption: "deposit_balance",
      scheduleConsent: true,
    });
    await startCheckout(r, deps(RETREAT));
    const pendingId = (await db.query<{ id: string }>("select id from pending_bookings")).rows[0].id;
    const id = await confirmPendingBooking(db, pendingId, {
      amountPaidMinor: 9200,
      presentmentCurrency: "gbp",
      paymentIntentId: "pi_1",
    });
    const b = await db.query<Record<string, unknown>>("select * from bookings where id = $1", [id]);
    expect(b.rows[0]).toMatchObject({
      status: "deposit_paid",
      amount_paid_minor: 9200,
      presentment_currency: "GBP",
      amount_paid_base_minor: 96000,
      stripe_payment_intent: "pi_1",
      payment_option: "deposit_balance",
    });
    expect(b.rows[0].schedule_consent_at).not.toBeNull();
    const items = await db.query<{ seq: number; status: string; amount_minor: number }>(
      "select seq, status, amount_minor from payment_schedule_items order by seq",
    );
    expect(items.rows).toEqual([
      { seq: 0, status: "paid", amount_minor: 96000 },
      { seq: 1, status: "scheduled", amount_minor: 384000 },
    ]);
    const guests = await db.query<{ email: string; is_booker: boolean }>(
      "select p.email, g.is_booker from booking_guests g join people p on p.id = g.person_id order by p.email",
    );
    expect(guests.rows).toEqual([
      { email: "layla@email.com", is_booker: true },
      { email: "sara@email.com", is_booker: false },
    ]);
  });
});

describe("handleCodeCheck", () => {
  it("returns the available value of a gift card", async () => {
    const code = await giftCard(50000);
    const res = await handleCodeCheck(
      { code: code.toLowerCase(), slug: "test-retreat" },
      "1.2.3.4",
      { db, usdRates: RATES, now: NOW, sendEmail: async () => {}, experience: RETREAT },
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, kind: "gift", availableAed: 50000, availableBase: 12525 });
  });

  it("code check throttles the 11th wrong attempt", async () => {
    const sent: string[] = [];
    const d = {
      db,
      usdRates: RATES,
      now: NOW,
      sendEmail: async (kind: string) => {
        sent.push(kind);
      },
      experience: EVENT,
    };
    for (let i = 0; i < 10; i++) {
      const res = await handleCodeCheck({ code: `EFZG-AAAA-AAA${"BCDEFGHJKL"[i]}`, slug: "test-event" }, "9.9.9.9", d);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false });
    }
    const eleventh = await handleCodeCheck({ code: "EFZG-AAAA-AAAM", slug: "test-event" }, "9.9.9.9", d);
    expect(eleventh.status).toBe(429);
    await handleCodeCheck({ code: "EFZG-AAAA-AAAN", slug: "test-event" }, "9.9.9.9", d);
    expect(sent).toEqual(["admin_error"]);
    const other = await handleCodeCheck({ code: "EFZG-AAAA-AAAP", slug: "test-event" }, "8.8.8.8", d);
    expect(other.status).toBe(200);
  });
});

/** Event booking for one, part paid by an AED 100 gift card, so a reservation exists too. */
async function eventWithGift(): Promise<BookingRequest> {
  return valid(EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: await giftCard(10000) });
}

async function heldState() {
  const h = await db.query<{ released_at: string | null }>("select released_at from holds");
  const r = await db.query<{ released_at: string | null }>("select released_at from gift_card_reservations");
  return { holdsReleased: h.rows.every((x) => x.released_at !== null), giftReleased: r.rows[0]?.released_at !== null };
}

const stripeError = (statusCode?: number) => Object.assign(new Error("stripe failed"), statusCode ? { statusCode } : {});

describe("checkout compensation", () => {
  it("releases holds and gift value after a definite 4xx from Stripe", async () => {
    stripe.createError = stripeError(400);
    await expect(startCheckout(await eventWithGift(), deps(EVENT))).rejects.toThrow("stripe failed");
    expect(await heldState()).toEqual({ holdsReleased: true, giftReleased: true });
  });

  it.each([
    ["a network error", stripeError()],
    ["a 5xx", stripeError(502)],
  ])("keeps holds after %s (a session may exist)", async (_label, err) => {
    stripe.createError = err;
    await expect(startCheckout(await eventWithGift(), deps(EVENT))).rejects.toThrow("stripe failed");
    expect(await heldState()).toEqual({ holdsReleased: false, giftReleased: false });
  });

  function failingAttachDb(): SqlClient {
    return {
      query: (sql: string, params?: unknown[]) =>
        /set checkout_session_id/.test(sql) ? Promise.reject(new Error("db down")) : db.query(sql, params),
    } as SqlClient;
  }

  it("expires the session, then releases, when recording the session fails", async () => {
    await expect(startCheckout(await eventWithGift(), { ...deps(EVENT), db: failingAttachDb() })).rejects.toThrow(
      "db down",
    );
    expect(stripe.expired).toEqual(["cs_test_1"]);
    expect(await heldState()).toEqual({ holdsReleased: true, giftReleased: true });
  });

  it("keeps holds when the session cannot be expired", async () => {
    stripe.expireError = stripeError();
    await expect(startCheckout(await eventWithGift(), { ...deps(EVENT), db: failingAttachDb() })).rejects.toThrow(
      "db down",
    );
    expect(await heldState()).toEqual({ holdsReleased: false, giftReleased: false });
  });
});

describe("credit claims", () => {
  async function credit(aed = 10000) {
    const owner = (
      await db.query<{ id: string }>("insert into people (name, email) values ('C', 'c@example.com') returning id")
    ).rows[0].id;
    return issueCredit(db, owner, aed, null, NOW);
  }
  const withCredit = (code: string, email: string) =>
    valid(EVENT, {
      lines: [{ ticketKey: "whole", qty: 1 }],
      creditCode: code,
      booker: { name: "Guest", email, phone: "+971500000000" },
    });

  it("a second pending booking with the same credit gets CREDIT_INVALID", async () => {
    const c = await credit();
    await startCheckout(withCredit(c.code, "a@example.com"), deps(EVENT));
    const err = await startCheckout(withCredit(c.code, "b@example.com"), deps(EVENT)).catch((e) => e);
    expect(err).toBeInstanceOf(CodeError);
    expect((err as CodeError).code).toBe("CREDIT_INVALID");
    expect(await findUsableCredit(db, c.code, NOW)).toBeNull();
    expect(await count("pending_bookings")).toBe(1);
  });

  it("a lapsed claim makes the credit reusable, and the first checkout then confirms without it", async () => {
    const c = await credit();
    await startCheckout(withCredit(c.code, "a@example.com"), deps(EVENT));
    const firstId = (await db.query<{ id: string }>("select id from pending_bookings")).rows[0].id;
    const later = new Date(NOW.getTime() + 32 * 60_000);
    expect(await findUsableCredit(db, c.code, later)).not.toBeNull();
    await startCheckout(withCredit(c.code, "b@example.com"), { ...deps(EVENT), now: later });
    const claim = await db.query<{ claimed_pending_id: string }>("select claimed_pending_id from credits");
    expect(claim.rows[0].claimed_pending_id).not.toBe(firstId);

    const bookingId = await confirmPendingBooking(db, firstId, { amountPaidMinor: 18000, presentmentCurrency: "aed" });
    const b = await db.query<{ credit_applied_aed_minor: number; policy_snapshot: { credit_claim_lost?: boolean } }>(
      "select credit_applied_aed_minor, policy_snapshot from bookings where id = $1",
      [bookingId],
    );
    expect(b.rows[0].credit_applied_aed_minor).toBe(0);
    expect(b.rows[0].policy_snapshot.credit_claim_lost).toBe(true);
    const r = await db.query<{ redeemed_booking_id: string | null }>("select redeemed_booking_id from credits");
    expect(r.rows[0].redeemed_booking_id).toBeNull();
  });
});

describe("minimum first charge", () => {
  it("uses less gift value so the card charge is at least AED 2", async () => {
    const r = valid(EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: await giftCard(27900) });
    await startCheckout(r, deps(EVENT));
    expect(stripe.sessions[0].line_items?.[0].price_data?.unit_amount).toBe(200);
    const res = await db.query<{ amount_aed_minor: number }>("select amount_aed_minor from gift_card_reservations");
    expect(res.rows[0].amount_aed_minor).toBe(27800);
  });
});

describe("handleCheckout", () => {
  it("counts wrong codes at checkout towards the code limit", async () => {
    const sent: string[] = [];
    const hdeps = {
      loadExperience: async (slug: string) => (slug === EVENT.slug ? EVENT : null),
      withDb: <T,>(fn: (d: SqlClient) => Promise<T>) => fn(db),
      stripe,
      usdRates: async () => RATES,
      origin: "https://efzin.test",
      now: NOW,
      sendEmail: async (kind: string) => {
        sent.push(kind);
      },
    };
    const body = (code: string) => ({
      slug: EVENT.slug,
      lines: [{ ticketKey: "whole", qty: 1 }],
      booker: { name: "Layla", email: "layla@email.com", phone: "+971500000000" },
      guests: [],
      paymentOption: "full",
      policyAccepted: true,
      giftCode: code,
    });
    for (let i = 0; i < 10; i++) {
      const res = await handleCheckout(body(`EFZG-BBBB-BBB${"CDEFGHJKLM"[i]}`), "7.7.7.7", hdeps);
      expect(res).toEqual({ status: 400, body: { error: "gift_invalid" } });
    }
    const eleventh = await handleCheckout(body("EFZG-BBBB-BBBN"), "7.7.7.7", hdeps);
    expect(eleventh.status).toBe(429);
    expect(sent).toEqual(["admin_error"]);
    const check = await handleCodeCheck({ code: "EFZG-BBBB-BBBP", slug: EVENT.slug }, "7.7.7.7", {
      db,
      usdRates: RATES,
      now: NOW,
      sendEmail: hdeps.sendEmail,
      experience: EVENT,
    });
    expect(check.status).toBe(429);
    expect(stripe.sessions).toHaveLength(0);
  });
});
