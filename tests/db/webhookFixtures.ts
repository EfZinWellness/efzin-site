import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";
import { expect } from "vitest";
import { freshDb } from "./harness";
import { FakeStripe } from "./fakeStripe";
import { ExperienceSchema, type Experience } from "../../lib/content/schema";
import { syncContent } from "../../lib/content/sync";
import { validateBooking, type BookingRequest } from "../../lib/booking/validate";
import { startCheckout } from "../../lib/stripe/checkout";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { issueCredit } from "../../lib/credits/db";
import type { AuthAdmin } from "../../lib/auth/provision";
import type { WebhookDeps } from "../../lib/stripe/handlers";

export const NOW = new Date("2027-01-10T09:00:00Z");
export const RATES = { EUR: 0.92, USD: 1 };
export const ORIGIN = "https://efzin.test";

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

export const EVENT = experience({
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

export const RETREAT = experience({
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

export interface SentEmail {
  kind: string;
  to: string;
  data: Record<string, unknown>;
}

/** Creates users in the stub auth.users table so people.auth_user_id can reference them. */
export class FakeAuth implements AuthAdmin {
  links: { email: string; redirectTo: string }[] = [];
  constructor(private db: PGlite) {}
  async ensureUser(email: string) {
    const found = await this.db.query<{ id: string }>("select id from auth.users where email = $1", [email]);
    if (found.rows[0]) return { userId: found.rows[0].id };
    const r = await this.db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    return { userId: r.rows[0].id };
  }
  async magicLink(email: string, redirectTo: string) {
    this.links.push({ email, redirectTo });
    return `https://auth.test/magic?email=${encodeURIComponent(email)}`;
  }
}

export interface World {
  db: PGlite;
  stripe: FakeStripe;
  emails: SentEmail[];
  auth: FakeAuth;
  deps: WebhookDeps;
}

export async function world(): Promise<World> {
  const db = await freshDb();
  const r = await syncContent(db, [EVENT, RETREAT]);
  expect(r.errors).toEqual([]);
  const stripe = new FakeStripe();
  const emails: SentEmail[] = [];
  const auth = new FakeAuth(db);
  const deps: WebhookDeps = {
    db,
    stripe,
    auth,
    origin: ORIGIN,
    sendEmail: async (kind, to, data) => {
      emails.push({ kind, to, data });
    },
  };
  return { db, stripe, emails, auth, deps };
}

export function valid(exp: Experience, body: Record<string, unknown>): BookingRequest {
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

/** Starts a checkout through the real code path; returns the pending id and session id. */
export async function checkout(
  w: World,
  exp: Experience,
  body: Record<string, unknown>,
  now = NOW,
): Promise<{ pendingId: string; sessionId: string }> {
  const out = await startCheckout(valid(exp, body), {
    db: w.db,
    stripe: w.stripe,
    now,
    usdRates: RATES,
    origin: ORIGIN,
    experience: exp,
  });
  if (out.kind !== "redirect") throw new Error("expected a Checkout redirect");
  const sessionId = out.url.split("/").pop()!;
  const p = await w.db.query<{ id: string }>("select id from pending_bookings where checkout_session_id = $1", [sessionId]);
  return { pendingId: p.rows[0].id, sessionId };
}

export async function giftCard(db: PGlite, aed: number, ref = `pi_gift_${aed}`): Promise<string> {
  const buyer = await buyerId(db);
  const [c] = await issueGiftCards(db, {
    count: 1,
    initialAedMinor: aed,
    buyerPersonId: buyer,
    deliverOn: "2027-01-01",
    paymentRef: ref,
  });
  await activateGiftCards(db, ref, NOW);
  return c.code;
}

export async function buyerId(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into people (name, email) values ('Buyer', 'buyer@example.com')
     on conflict ((lower(email))) do update set name = excluded.name returning id`,
  );
  return r.rows[0].id;
}

export async function credit(db: PGlite, aed: number): Promise<string> {
  const owner = (
    await db.query<{ id: string }>("insert into people (name, email) values ('C', 'c@example.com') returning id")
  ).rows[0].id;
  return (await issueCredit(db, owner, aed, null, NOW)).code;
}

export function event(id: string, type: string, object: Record<string, unknown>): Stripe.Event {
  return { id, object: "event", type, data: { object } } as unknown as Stripe.Event;
}

export function completedBooking(
  id: string,
  pendingId: string,
  sessionId: string,
  over: Record<string, unknown> = {},
): Stripe.Event {
  return event(id, "checkout.session.completed", {
    object: "checkout.session",
    id: sessionId,
    mode: "payment",
    payment_status: "paid",
    status: "complete",
    metadata: { kind: "booking", pending_booking_id: pendingId },
    amount_total: 9200,
    currency: "gbp",
    payment_intent: `pi_${sessionId}`,
    setup_intent: null,
    customer: null,
    ...over,
  });
}

export async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int n from (${sql}) t`, params)).rows[0].n;
}
