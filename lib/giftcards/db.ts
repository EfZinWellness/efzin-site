import { randomBytes } from "node:crypto";
import type { SqlClient } from "../content/sync";
import { creditExpiry } from "../policy/credit";
import { generateGiftCode, normaliseCode } from "./code";

const MAX_CODE_ATTEMPTS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IssueGiftCardsInput = {
  count: number;
  initialAedMinor: number;
  buyerPersonId: string;
  recipient?: { name?: string | null; email?: string | null };
  message?: string | null;
  suggestedExperienceId?: string | null;
  /** Delivery date, YYYY-MM-DD. */
  deliverOn: string;
  batchId?: string;
  /** Stripe payment intent that pays for the cards. */
  paymentRef: string;
};

/** Creates cards in `pending_payment` (balance 0, no ledger) until the payment is confirmed. */
export async function issueGiftCards(
  db: SqlClient,
  input: IssueGiftCardsInput,
): Promise<{ id: string; code: string }[]> {
  if (!Number.isInteger(input.count) || input.count < 1) throw new Error("INVALID_COUNT");
  let batchId = input.batchId ?? null;
  if (!batchId && input.count > 1) {
    const b = await db.query<{ id: string }>(
      "insert into gift_card_batches (buyer_person_id, quantity) values ($1, $2) returning id",
      [input.buyerPersonId, input.count],
    );
    batchId = b.rows[0].id;
  }
  const out: { id: string; code: string }[] = [];
  for (let i = 0; i < input.count; i++) {
    let made: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !made; attempt++) {
      const code = generateGiftCode((n) => randomBytes(n));
      const r = await db.query<{ id: string }>(
        `insert into gift_cards
           (code, initial_aed_minor, buyer_person_id, recipient_name, recipient_email, message,
            suggested_experience_id, deliver_on, purchase_batch_id, stripe_payment_intent)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (code) do nothing
         returning id`,
        [
          code,
          input.initialAedMinor,
          input.buyerPersonId,
          input.recipient?.name ?? null,
          input.recipient?.email ?? null,
          input.message ?? null,
          input.suggestedExperienceId ?? null,
          input.deliverOn,
          batchId,
          input.paymentRef,
        ],
      );
      if (r.rows[0]) made = { id: r.rows[0].id, code };
    }
    if (!made) throw new Error("GIFT_CODE_COLLISION");
    out.push(made);
  }
  return out;
}

/** Payment confirmed: cards become active with an `issue` ledger row. Expires 12 months after `now`. Returns how many were activated. */
export async function activateGiftCards(
  db: SqlClient,
  stripePaymentIntent: string,
  now: Date = new Date(),
): Promise<number> {
  const r = await db.query<{ n: number }>("select activate_gift_cards($1, $2) as n", [
    stripePaymentIntent,
    creditExpiry(now).toISOString(),
  ]);
  return r.rows[0].n;
}

/** Holds value on a card for a pending checkout. Throws GIFT_INVALID, GIFT_EXPIRED or GIFT_INSUFFICIENT. */
export async function reserveGiftCard(
  db: SqlClient,
  code: string,
  amountAedMinor: number,
  pendingBookingId: string,
  expiresAt: Date,
): Promise<string> {
  const r = await db.query<{ id: string }>("select reserve_gift_card($1, $2, $3, $4) as id", [
    normaliseCode(code),
    amountAedMinor,
    pendingBookingId,
    expiresAt.toISOString(),
  ]);
  return r.rows[0].id;
}

/** Payment confirmed: spends the reserved value against the booking. */
export async function redeemReservation(db: SqlClient, reservationId: string, bookingId: string): Promise<void> {
  await db.query("select redeem_gift_reservation($1, $2)", [reservationId, bookingId]);
}

/** Checkout abandoned or failed: frees the reserved value. */
export async function releaseReservation(db: SqlClient, reservationId: string): Promise<void> {
  await db.query("update gift_card_reservations set released_at = now() where id = $1 and released_at is null", [
    reservationId,
  ]);
}

/** Puts value back on the card (e.g. a refunded booking that was paid with it). */
export async function returnToGiftCard(
  db: SqlClient,
  cardId: string,
  bookingId: string,
  aedMinor: number,
): Promise<void> {
  await db.query("select return_to_gift_card($1, $2, $3)", [cardId, bookingId, aedMinor]);
}

/** Refunded purchase: voids all cards of the payment when none has been used. */
export async function voidIfUnused(db: SqlClient, stripePaymentIntent: string): Promise<"voided" | "partly_used"> {
  const r = await db.query<{ s: "voided" | "partly_used" }>("select void_gift_cards_if_unused($1) as s", [
    stripePaymentIntent,
  ]);
  return r.rows[0].s;
}

/** Expires active cards past their expiry date; returns how many. */
export async function expireGiftCards(db: SqlClient, now: Date): Promise<number> {
  const r = await db.query<{ n: number }>("select expire_gift_cards($1) as n", [now.toISOString()]);
  return r.rows[0].n;
}

export type GiftBalance = {
  id: string;
  code: string;
  status: "pending_payment" | "active" | "void" | "expired";
  initialAedMinor: number;
  /** Sum of the ledger. */
  balanceAedMinor: number;
  /** Balance minus live reservations. */
  availableAedMinor: number;
  expiresAt: string | null;
};

/** Looks a card up by id or by (loosely typed) code. */
export async function getGiftBalance(db: SqlClient, codeOrId: string): Promise<GiftBalance | null> {
  const byId = UUID_RE.test(codeOrId);
  const r = await db.query<{
    id: string;
    code: string;
    status: GiftBalance["status"];
    initial_aed_minor: number;
    balance_aed_minor: number;
    available: number;
    expires_at: string | null;
  }>(
    `select id, code, status, initial_aed_minor, balance_aed_minor,
            gift_card_available(id) as available, expires_at
       from gift_cards where ${byId ? "id = $1" : "code = $1"}`,
    [byId ? codeOrId : normaliseCode(codeOrId)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    initialAedMinor: row.initial_aed_minor,
    balanceAedMinor: row.balance_aed_minor,
    availableAedMinor: row.available,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
  };
}
