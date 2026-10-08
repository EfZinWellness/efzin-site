import { releasePending } from "../booking/pending";
import type { SqlClient } from "../content/sync";
import type { SendEmailFn } from "../email/send";
import { step, type JobContext } from "./context";

/** Holds and reservations are released this long after they expire (a late webhook goes first). */
export const RELEASE_GRACE_MS = 5 * 60_000;
/** Gift cards whose purchase never completed are removed after this long (Checkout sessions last at most 24 h). */
export const GIFT_PENDING_MAX_MS = 25 * 3_600_000;

export interface HourlySummary {
  releasedCheckouts: number | null;
  releasedStray: number | null;
  removedGiftCards: number | null;
}

/** Pending checkouts with a hold, gift reservation or credit claim expired before the cutoff. */
async function releaseExpiredCheckouts(db: SqlClient, cutoff: Date): Promise<number> {
  const r = await db.query<{ id: string }>(
    `select p.id from pending_bookings p
      where p.confirmed_booking_id is null and (
        exists (select 1 from holds h where h.id = any(p.hold_ids) and h.released_at is null and h.expires_at < $1)
        or exists (select 1 from gift_card_reservations r
                    where r.pending_booking_id = p.id and r.released_at is null and r.expires_at < $1)
        or exists (select 1 from credits c where c.claimed_pending_id = p.id and c.claim_expires_at < $1))
      order by p.created_at`,
    [cutoff.toISOString()],
  );
  for (const p of r.rows) await releasePending(db, p.id);
  return r.rows.length;
}

/** Anything still unreleased and long expired that no pending checkout points to. */
async function releaseStray(db: SqlClient, cutoff: Date, now: Date): Promise<number> {
  const h = await db.query<{ id: string }>(
    "update holds set released_at = $2 where released_at is null and expires_at < $1 returning id",
    [cutoff.toISOString(), now.toISOString()],
  );
  const g = await db.query<{ id: string }>(
    `update gift_card_reservations set released_at = $2
      where released_at is null and redeemed_booking_id is null and expires_at < $1 returning id`,
    [cutoff.toISOString(), now.toISOString()],
  );
  await db.query("update credits set claimed_pending_id = null, claim_expires_at = null where claim_expires_at < $1", [
    cutoff.toISOString(),
  ]);
  return h.rows.length + g.rows.length;
}

/**
 * Gift cards (and bulk batches) still awaiting payment a day after they were created: the
 * Checkout session expired. Removed rather than voided so a very late payment finds no cards and
 * Tanya is alerted (gift_purchase_unmatched). Active cards are never touched.
 */
async function removeUnpaidGiftCards(db: SqlClient, now: Date): Promise<number> {
  const before = new Date(now.getTime() - GIFT_PENDING_MAX_MS).toISOString();
  await db.query("begin");
  try {
    const cards = await db.query<{ id: string }>(
      "delete from gift_cards where status = 'pending_payment' and created_at < $1 returning id",
      [before],
    );
    await db.query(
      `delete from gift_card_batches bt
        where bt.created_at < $1 and not exists (select 1 from gift_cards g where g.purchase_batch_id = bt.id)`,
      [before],
    );
    await db.query("commit");
    return cards.rows.length;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * The hourly job: frees spots, gift value and credit claims of checkouts that expired more than
 * 5 minutes ago, and clears gift cards whose payment never came. (Gift delivery claims are not
 * reclaimed here: delivered_at is set only around a send that either completes or is undone.)
 */
export async function runHourly(db: SqlClient, now: Date, deps: { sendEmail: SendEmailFn; origin?: string }): Promise<HourlySummary> {
  const ctx: JobContext = { db, now, sendEmail: deps.sendEmail, origin: deps.origin ?? "" };
  const cutoff = new Date(now.getTime() - RELEASE_GRACE_MS);
  return {
    releasedCheckouts: await step(ctx, "hourly_release_checkouts", () => releaseExpiredCheckouts(db, cutoff)),
    releasedStray: await step(ctx, "hourly_release_stray", () => releaseStray(db, cutoff, now)),
    removedGiftCards: await step(ctx, "hourly_remove_unpaid_gift_cards", () => removeUnpaidGiftCards(db, now)),
  };
}
