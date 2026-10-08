import type { SqlClient } from "../content/sync";
import type { StripeApi } from "./client";
import { ensureStripeCustomer } from "./customers";

export interface SelfServeDeps {
  db: SqlClient;
  stripe: StripeApi;
  /** Site origin for return URLs. */
  origin: string;
}

/** not_found: no such booking for this booker. not_payable: not on an open plan. nothing_due: no unpaid items. */
export type SelfServeErrorCode = "not_found" | "not_payable" | "nothing_due";

export class SelfServeError extends Error {
  constructor(public code: SelfServeErrorCode) {
    super(code);
    this.name = "SelfServeError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Pay the rest now": a Checkout payment for the sum of the booking's unpaid (scheduled or
 * failed) items, in the booking's base currency, for the booker's Stripe customer. Only the
 * booker, only while the booking is `deposit_paid`. The webhook (kind `pay_rest`) marks the
 * items paid and voids open invoices.
 */
export async function startPayRest(deps: SelfServeDeps, bookingId: string, personId: string): Promise<{ url: string }> {
  const { db, stripe } = deps;
  if (!UUID_RE.test(bookingId)) throw new SelfServeError("not_found");
  const b = await db.query<{ status: string; base_currency: string | null; title: string }>(
    `select b.status, b.base_currency, e.title
       from bookings b join experiences e on e.id = b.experience_id
      where b.id = $1 and b.booker_person_id = $2`,
    [bookingId, personId],
  );
  const booking = b.rows[0];
  if (!booking) throw new SelfServeError("not_found");
  if (booking.status !== "deposit_paid") throw new SelfServeError("not_payable");

  const items = await db.query<{ id: string; amount_minor: number; currency: string }>(
    `select id, amount_minor, currency from payment_schedule_items
      where booking_id = $1 and status in ('scheduled', 'failed') order by seq`,
    [bookingId],
  );
  const total = items.rows.reduce((s, i) => s + i.amount_minor, 0);
  if (total <= 0) throw new SelfServeError("nothing_due");
  const currency = (booking.base_currency ?? items.rows[0].currency).toLowerCase();

  const customer = await ensureStripeCustomer(db, stripe, personId);
  const metadata = { kind: "pay_rest", booking_id: bookingId };
  const back = `${deps.origin}/account/bookings/${bookingId}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer,
      client_reference_id: bookingId,
      metadata,
      payment_intent_data: { metadata },
      line_items: [
        {
          quantity: 1,
          price_data: { currency, unit_amount: total, product_data: { name: `${booking.title}: remaining balance` } },
        },
      ],
      success_url: `${back}?paid=1`,
      cancel_url: back,
    },
    // A double click returns the same session instead of opening a second payment for the same items.
    { idempotencyKey: `efzin-payrest-${bookingId}-${items.rows.map((i) => i.id).join(".")}-${total}` },
  );
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
  return { url: session.url };
}

/**
 * "Update card": a setup-mode Checkout for the person's own Stripe customer. Only for someone
 * who is the booker of an open plan (`deposit_paid`); with `bookingId`, that booking must be one.
 * The webhook (kind `update_card`) makes the new card the default and moves open invoices to it.
 */
export async function startUpdateCard(
  deps: SelfServeDeps,
  personId: string,
  bookingId?: string,
): Promise<{ url: string }> {
  const { db, stripe } = deps;
  if (bookingId !== undefined && !UUID_RE.test(bookingId)) throw new SelfServeError("not_found");
  const b = await db.query<{ id: string; base_currency: string | null }>(
    `select id, base_currency from bookings
      where booker_person_id = $1 and status = 'deposit_paid' and ($2::uuid is null or id = $2::uuid)
      order by created_at desc limit 1`,
    [personId, bookingId ?? null],
  );
  const booking = b.rows[0];
  if (!booking) throw new SelfServeError("not_found");

  const customer = await ensureStripeCustomer(db, stripe, personId);
  const metadata = { kind: "update_card", person_id: personId };
  const back = bookingId ? `${deps.origin}/account/bookings/${bookingId}` : `${deps.origin}/account`;
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: (booking.base_currency ?? "AED").toLowerCase(),
    metadata,
    setup_intent_data: { metadata },
    success_url: `${back}?card=updated`,
    cancel_url: back,
  });
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
  return { url: session.url };
}
