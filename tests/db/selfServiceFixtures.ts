import type { PGlite } from "@electric-sql/pglite";
import { seedBooking, type SeedBooking, type SeedItem } from "./cronFixtures";
import { giftCard, type World } from "./webhookFixtures";

/** Event starts 2027-02-01 06:00Z (10:00 Dubai); retreat 2027-06-10 07:00Z. */
export const EVENT_START = Date.parse("2027-02-01T06:00:00Z");
export const RETREAT_START = Date.parse("2027-06-10T07:00:00Z");
export const hoursBefore = (start: number, h: number) => new Date(start - h * 3_600_000);
export const daysBefore = (start: number, d: number) => hoursBefore(start, d * 24);

export interface PaymentFacts {
  paymentIntent?: string;
  /** amount_paid_base_minor (defaults to the paid items). */
  paidBase?: number;
  amountAed?: number;
  gift?: { cardId: string; aed: number; base: number };
}

/** seedBooking plus the payment facts a real checkout records. */
export async function booking(
  w: World,
  s: Omit<SeedBooking, "status"> & { status?: SeedBooking["status"] },
  pay: PaymentFacts = {},
): Promise<{ bookingId: string; itemIds: Record<number, string>; ticketId: string; bookerId: string }> {
  const b = await seedBooking(w.db, { status: "paid", ...s });
  const paidBase = pay.paidBase ?? null;
  await w.db.query(
    `update bookings set stripe_payment_intent = $2,
            amount_paid_base_minor = coalesce($3, amount_paid_base_minor),
            amount_aed_minor = coalesce($4, $3, amount_aed_minor),
            gift_card_id = $5, gift_card_applied_aed_minor = $6, gift_card_applied_base_minor = $7
      where id = $1`,
    [b.bookingId, pay.paymentIntent ?? null, paidBase, pay.amountAed ?? null, pay.gift?.cardId ?? null, pay.gift?.aed ?? 0, pay.gift?.base ?? 0],
  );
  if (pay.gift) {
    // The redeem the checkout made (so the return cap allows it).
    await w.db.query("select gift_card_ledger_add($1, $2, $3, 'redeem')", [pay.gift.cardId, b.bookingId, -pay.gift.aed]);
  }
  const bookerId = (await w.db.query<{ id: string }>("select booker_person_id as id from bookings where id = $1", [b.bookingId])).rows[0].id;
  return { ...b, bookerId };
}

/** An active gift card with `aed` on it; returns its id. */
export async function giftCardId(db: PGlite, aed: number, ref?: string): Promise<string> {
  const code = await giftCard(db, aed, ref);
  return (await db.query<{ id: string }>("select id from gift_cards where code = $1", [code])).rows[0].id;
}

/**
 * Retreat on a plan: deposit 48000 (18000 card + 30000 gift when `withGift`), instalment 48000
 * paid by invoice in_r1, two of 72000 still scheduled. Charges: deposit (EUR, fee AED 2400 at 4.0
 * → EUR 600) and instalment (EUR, fee AED 6000 → EUR 1500).
 */
export async function retreatPlan(w: World, withGift: boolean, email = "rana@x.com") {
  const cardId = withGift ? await giftCardId(w.db, 150000) : null;
  const items: SeedItem[] = [
    { seq: 0, dueOn: "2027-01-10", amount: withGift ? 18000 : 48000, status: "paid" },
    { seq: 1, dueOn: "2027-02-10", amount: 48000, status: "paid", invoice: "in_r1" },
    { seq: 2, dueOn: "2027-03-10", amount: 72000, status: "scheduled" },
    { seq: 3, dueOn: "2027-05-31", amount: 72000, status: "scheduled" },
  ];
  const b = await booking(
    w,
    { slug: "test-retreat", status: "deposit_paid", booker: { name: "Rana R", email, customer: "cus_r" }, items },
    { paymentIntent: "pi_dep", paidBase: 96000, amountAed: 400000, gift: cardId ? { cardId, aed: 120000, base: 30000 } : undefined },
  );
  w.stripe.addCharge({ id: "ch_dep", paymentIntent: "pi_dep", amount: withGift ? 18000 : 48000, currency: "eur", fee: 2400, exchangeRate: 4, created: 1_800_000_000 });
  w.stripe.invoicePaymentIntent.in_r1 = "pi_inst";
  w.stripe.addCharge({ id: "ch_inst", paymentIntent: "pi_inst", amount: 48000, currency: "eur", fee: 6000, exchangeRate: 4, created: 1_800_100_000 });
  return { ...b, cardId };
}

/** Event booking paid in full by card: 28000 AED, fee 1100 AED (same currency). */
export async function paidEvent(w: World, email = "layla@x.com", guests: SeedBooking["guests"] = []) {
  const b = await booking(
    w,
    { slug: "test-event", booker: { name: "Layla H", email, customer: `cus_${email}` }, guests, items: [{ seq: 0, dueOn: "2027-01-10", amount: 28000, status: "paid" }] },
    { paymentIntent: `pi_${email}` },
  );
  w.stripe.addCharge({ id: `ch_${email}`, paymentIntent: `pi_${email}`, amount: 28000, currency: "aed", fee: 1100, created: 1_800_000_000 });
  return b;
}

export const status = async (db: PGlite, table: string, id: string) =>
  (await db.query<{ status: string }>(`select status from ${table} where id = $1`, [id])).rows[0].status;

export const spots = async (db: PGlite, ticketId: string) =>
  (await db.query<{ n: number }>("select available_spots($1) as n", [ticketId])).rows[0].n;

export const giftBalance = async (db: PGlite, cardId: string) =>
  (await db.query<{ n: number }>("select balance_aed_minor as n from gift_cards where id = $1", [cardId])).rows[0].n;

/** Refunds the fake recorded, as { charge, amount }. */
export const refunds = (w: World) => w.stripe.refundsCreated.map((r) => ({ charge: r.params.charge, amount: r.params.amount }));
