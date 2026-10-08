import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";
import { freshDb } from "./harness";
import { ExperienceSchema, type Experience } from "../../lib/content/schema";
import { syncContent } from "../../lib/content/sync";
import { validateBooking, type BookingRequest } from "../../lib/booking/validate";
import { SoldOutError } from "../../lib/booking/pending";
import { confirmPendingBooking } from "../../lib/booking/confirm";
import { startCheckout } from "../../lib/stripe/checkout";
import type { StripeApi } from "../../lib/stripe/client";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { issueCredit } from "../../lib/credits/db";
import { handleCodeCheck, resetCodeThrottleForTests } from "../../lib/booking/codes";

/** Records every call; never talks to Stripe. */
class FakeStripe implements StripeApi {
  sessions: Stripe.Checkout.SessionCreateParams[] = [];
  customersCreated: Stripe.CustomerCreateParams[] = [];
  checkout = {
    sessions: {
      create: async (params: Stripe.Checkout.SessionCreateParams) => {
        this.sessions.push(params);
        const id = `cs_test_${this.sessions.length}`;
        return { id, url: `https://checkout.stripe.test/${id}` };
      },
    },
  };
  customers = {
    create: async (params: Stripe.CustomerCreateParams) => {
      this.customersCreated.push(params);
      return { id: `cus_test_${this.customersCreated.length}` };
    },
  };
}

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
    const expiry = NOW.getTime() + 31 * 60_000;
    expect(new Date(holds.rows[0].expires_at).getTime()).toBe(expiry);
    expect(holds.rows[0].checkout_session_id).toBe("cs_test_1");

    const s = stripe.sessions[0];
    expect(s.mode).toBe("payment");
    expect(s.expires_at).toBe(expiry / 1000);
    expect(s.line_items?.[0].price_data?.unit_amount).toBe(28000 * 2 + 15000);
    expect(s.line_items?.[0].price_data?.currency).toBe("aed");
    expect(s.line_items?.[0].price_data?.product_data?.name).toBe("Test Event — Pay in full");
    expect(s.customer).toBeUndefined();
    const pending = await db.query<{ id: string; kind: string; checkout_session_id: string; hold_ids: string[] }>(
      "select id, kind, checkout_session_id, hold_ids from pending_bookings",
    );
    expect(pending.rows[0]).toMatchObject({ kind: "booking", checkout_session_id: "cs_test_1" });
    expect(pending.rows[0].hold_ids).toHaveLength(2);
    expect(s.metadata).toEqual({ kind: "booking", pending_booking_id: pending.rows[0].id });
    expect(s.success_url).toBe("https://efzin.test/book/test-event/confirmed?session={CHECKOUT_SESSION_ID}");
    expect(s.after_expiration?.recovery?.enabled).toBe(true);
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
    expect(s.customer).toBe("cus_test_1");
    const p = await db.query<{ stripe_customer_id: string }>(
      "select stripe_customer_id from people where email = 'layla@email.com'",
    );
    expect(p.rows[0].stripe_customer_id).toBe("cus_test_1");
    const payload = (await db.query<{ payload: { schedule: { amountMinor: number }[] } }>("select payload from pending_bookings"))
      .rows[0].payload;
    expect(payload.schedule.map((i) => i.amountMinor)).toEqual([48000, 192000]);
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
      presentment_currency: "gbp",
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
