import type { SqlClient } from "../content/sync";
import { activateGiftCards } from "./db";

/**
 * Hook run after a paid gift card purchase has been activated and committed. Task 12 fills
 * it (deliver cards due today, buyer receipt). It must be safe to repeat: a webhook retry
 * calls it again for the same payment.
 */
export async function onGiftCardsActivated(db: SqlClient, paymentIntent: string): Promise<void> {
  void db;
  void paymentIntent;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `batch_id` / `gift_card_id`, when present, must be UUIDs (they are cast in SQL). */
export function giftMetadataValid(md: Record<string, string>): boolean {
  return [md.batch_id, md.gift_card_id].every((v) => v === undefined || UUID_RE.test(v));
}

export interface GiftPurchasePaid {
  sessionId: string;
  paymentIntent: string;
  /** What the buyer paid in total, in the presentment currency. */
  amountPaidMinor: number;
  presentmentCurrency: string;
  /** Session metadata: `batch_id` (several cards), `gift_card_id` (one card) or `payment_ref`. */
  metadata: Record<string, string>;
}

/**
 * Records the payment on the purchase's pending cards (payment intent, each card's share of
 * the amount paid, presentment currency) and activates them. Cards are found by the session
 * metadata's `batch_id` or `gift_card_id`, else by `payment_ref` (or the session id) stored
 * as their payment reference at issue. Returns the number of cards activated (0 on a repeat).
 */
export async function activateGiftPurchase(db: SqlClient, paid: GiftPurchasePaid, now: Date): Promise<number> {
  const md = paid.metadata;
  if (!giftMetadataValid(md)) throw new Error("GIFT_METADATA_INVALID");
  const cards = await db.query<{ id: string }>(
    `select id from gift_cards
      where status = 'pending_payment'
        and (purchase_batch_id = $1::uuid or id = $2::uuid or stripe_payment_intent = $3)
      order by created_at, id
      for update`,
    [md.batch_id ?? null, md.gift_card_id ?? null, md.payment_ref ?? paid.sessionId],
  );
  const n = cards.rows.length;
  if (n === 0) return 0;
  const share = Math.floor(paid.amountPaidMinor / n);
  const extra = paid.amountPaidMinor - share * n;
  for (const [i, c] of cards.rows.entries()) {
    await db.query(
      "update gift_cards set stripe_payment_intent = $2, amount_paid_minor = $3, presentment_currency = $4 where id = $1",
      [c.id, paid.paymentIntent, share + (i < extra ? 1 : 0), paid.presentmentCurrency.toUpperCase()],
    );
  }
  return activateGiftCards(db, paid.paymentIntent, now);
}
