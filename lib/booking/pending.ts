import type { SqlClient } from "../content/sync";
import type { Experience } from "../content/schema";
import { releaseReservation } from "../giftcards/db";
import type { Allocation } from "../payments/allocate";
import type { PaymentOption, ScheduleItem } from "../payments/schedule";
import { policyCopy } from "../policy/copy";
import { convertMinor } from "../pricing/convert";
import { upsertPersonByEmail } from "../people/upsert";
import { checkGift, claimCredit, lockCredit, planDiscounts, reserveGift } from "./discounts";
import { bookingTotal, scheduleFor } from "./quote";
import type { BookingRequest } from "./validate";

export { CodeError, type CodeErrorCode } from "./discounts";

/** Spots, gift value and credit claims are held for the Checkout session's lifetime: + 31 minutes. */
export const HOLD_MINUTES = 31;

export class SoldOutError extends Error {
  constructor(public readonly ticketKey: string) {
    super(`SOLD_OUT: ${ticketKey}`);
    this.name = "SoldOutError";
  }
}

export interface PendingPayload {
  slug: string;
  experienceId: string;
  title: string;
  baseCurrency: string;
  option: PaymentOption;
  totalMinor: number;
  /** Card (seq 0) + gift + credit value received at confirmation, in AED, for reporting. */
  paidNowAedMinor: number;
  booker: { personId: string; name: string; email: string; phone: string; howHeard?: string; ticketTypeId: string };
  guests: { name: string; email: string; phone?: string; ticketTypeId: string }[];
  lines: { ticketKey: string; ticketTypeId: string; qty: number; priceMinor: number }[];
  /** Before discounts. */
  schedule: ScheduleItem[];
  /** After gift then credit; `allocation.schedule` is what is charged. */
  allocation: Allocation;
  gift: { code: string; cardId: string; reservationId: string; reservedAedMinor: number } | null;
  /** The credit row is claimed (credits.claimed_pending_id) by this pending booking. */
  credit: { id: string; code: string; usedAedMinor: number } | null;
  policy: { template: string; copy: string[] };
  scheduleConsentAt: string | null;
  expiresAt: string;
}

const withUsd = (r: Record<string, number>) => ({ ...r, USD: 1 });

/**
 * In one transaction: upserts the booker, holds every ticket line (in ticket_type_id order,
 * so concurrent checkouts lock rows in the same order), plans gift/credit use, reserves the
 * gift card, claims the credit and stores the pending booking. Throws SoldOutError or
 * CodeError, leaving nothing behind. The caller then starts Stripe Checkout.
 */
export async function createPendingBooking(
  db: SqlClient,
  req: BookingRequest,
  exp: Experience,
  now: Date,
  usdRates: Record<string, number>,
): Promise<{ id: string; payload: PendingPayload }> {
  const rates = withUsd(usdRates);
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const tt = await db.query<{ id: string; key: string; experience_id: string }>(
    `select tt.id, tt.key, tt.experience_id from ticket_types tt
       join experiences e on e.id = tt.experience_id where e.slug = $1`,
    [exp.slug],
  );
  const ticketId = (key: string): string => {
    const row = tt.rows.find((r) => r.key === key);
    if (!row) throw new Error(`Ticket "${key}" of ${exp.slug} is not in the database (run sync:content)`);
    return row.id;
  };
  const lines = req.lines.map((l) => ({
    ticketKey: l.ticketKey,
    ticketTypeId: ticketId(l.ticketKey),
    qty: l.qty,
    priceMinor: exp.tickets.find((t) => t.key === l.ticketKey)!.priceMinor,
  }));
  // The booker takes the ticket left over once every guest has theirs.
  const bookerLine = lines.find((l) => req.guests.filter((g) => g.ticketKey === l.ticketKey).length < l.qty)!;

  await db.query("begin");
  try {
    const personId = await upsertPersonByEmail(db, req.booker);
    const pending = await db.query<{ id: string }>(
      "insert into pending_bookings (kind, payload) values ('booking', '{}'::jsonb) returning id",
    );
    const id = pending.rows[0].id;

    const holdIds: string[] = [];
    for (const l of [...lines].sort((a, b) => (a.ticketTypeId < b.ticketTypeId ? -1 : 1))) {
      try {
        const h = await db.query<{ id: string }>("select create_hold($1, $2, $3) as id", [
          l.ticketTypeId,
          l.qty,
          expiresAt.toISOString(),
        ]);
        holdIds.push(h.rows[0].id);
      } catch (err) {
        if (/SOLD_OUT/.test(err instanceof Error ? err.message : String(err))) throw new SoldOutError(l.ticketKey);
        throw err;
      }
    }

    const base = exp.baseCurrency;
    const totalMinor = bookingTotal(exp, req.lines);
    const schedule = scheduleFor(exp, totalMinor, req.paymentOption, now);
    const giftCard = req.giftCode ? await checkGift(db, req.giftCode, now) : null;
    const creditRow = req.creditCode ? await lockCredit(db, req.creditCode, now) : null;
    const plan = planDiscounts({
      schedule,
      totalMinor,
      base,
      rates,
      giftAvailableAed: giftCard?.availableAed ?? 0,
      creditAvailableAed: creditRow?.availableAed ?? 0,
    });

    let gift: PendingPayload["gift"] = null;
    if (giftCard && plan.giftAed > 0) {
      const reservationId = await reserveGift(db, giftCard.code, plan.giftAed, id, expiresAt);
      gift = { code: giftCard.code, cardId: giftCard.cardId, reservationId, reservedAedMinor: plan.giftAed };
    }
    let credit: PendingPayload["credit"] = null;
    if (creditRow && plan.creditAed > 0) {
      await claimCredit(db, creditRow.id, id, expiresAt);
      credit = { id: creditRow.id, code: creditRow.code, usedAedMinor: plan.creditAed };
    }

    const { allocation } = plan;
    const paidNowBase = allocation.schedule[0].amountMinor + allocation.giftUsedBaseMinor + allocation.creditUsedBaseMinor;
    const payload: PendingPayload = {
      slug: exp.slug,
      experienceId: tt.rows[0].experience_id,
      title: exp.title,
      baseCurrency: base,
      option: req.paymentOption,
      totalMinor,
      paidNowAedMinor: convertMinor(paidNowBase, base, "AED", rates, "round"),
      booker: { personId, ...req.booker, ticketTypeId: bookerLine.ticketTypeId },
      guests: req.guests.map((g) => ({
        name: g.name,
        email: g.email,
        ...(g.phone ? { phone: g.phone } : {}),
        ticketTypeId: ticketId(g.ticketKey),
      })),
      lines,
      schedule,
      allocation,
      gift,
      credit,
      policy: { template: exp.policy, copy: policyCopy(exp.policy) },
      scheduleConsentAt: req.paymentOption !== "full" && req.scheduleConsent ? now.toISOString() : null,
      expiresAt: expiresAt.toISOString(),
    };
    await db.query(
      "update pending_bookings set payload = $2::jsonb, hold_ids = $3::uuid[], reservation_ids = $4::uuid[] where id = $1",
      [id, JSON.stringify(payload), holdIds, gift ? [gift.reservationId] : []],
    );
    await db.query("commit");
    return { id, payload };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

const HOLDS_OF = "select unnest(hold_ids) from pending_bookings where id = $1";

/**
 * Moves the expiry of the holds, gift reservations and credit claim of a pending booking to
 * `expiresAt` (only ever later), so they never lapse before the Checkout session does.
 */
export async function extendPendingExpiry(db: SqlClient, pendingId: string, expiresAt: Date): Promise<void> {
  const at = expiresAt.toISOString();
  await db.query(
    `update holds set expires_at = greatest(expires_at, $2) where released_at is null and id in (${HOLDS_OF})`,
    [pendingId, at],
  );
  await db.query(
    `update gift_card_reservations set expires_at = greatest(expires_at, $2)
      where pending_booking_id = $1 and released_at is null`,
    [pendingId, at],
  );
  await db.query(
    "update credits set claim_expires_at = greatest(claim_expires_at, $2) where claimed_pending_id = $1",
    [pendingId, at],
  );
  await db.query(
    "update pending_bookings set payload = jsonb_set(payload, '{expiresAt}', to_jsonb($2::text)) where id = $1",
    [pendingId, at],
  );
}

/** Records the Checkout session on the pending booking and its holds. */
export async function attachCheckoutSession(db: SqlClient, pendingId: string, sessionId: string): Promise<void> {
  await db.query("update pending_bookings set checkout_session_id = $2 where id = $1", [pendingId, sessionId]);
  await db.query(`update holds set checkout_session_id = $2 where id in (${HOLDS_OF})`, [pendingId, sessionId]);
}

/** Frees the spots, gift value and credit claim of a checkout that never completed. */
export async function releasePending(db: SqlClient, pendingId: string): Promise<void> {
  await db.query(`update holds set released_at = now() where released_at is null and id in (${HOLDS_OF})`, [pendingId]);
  const r = await db.query<{ id: string }>(
    "select id from gift_card_reservations where pending_booking_id = $1 and released_at is null",
    [pendingId],
  );
  for (const row of r.rows) await releaseReservation(db, row.id);
  await releaseCreditClaim(db, pendingId);
}

export async function releaseCreditClaim(db: SqlClient, pendingId: string): Promise<void> {
  await db.query("update credits set claimed_pending_id = null, claim_expires_at = null where claimed_pending_id = $1", [
    pendingId,
  ]);
}
