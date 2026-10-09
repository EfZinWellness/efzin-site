import type { SqlClient } from "../content/sync";
import { redeemCredit } from "../credits/db";
import { redeemReservation, releaseReservation } from "../giftcards/db";
import { balanceDueDate, calendarDate, type ScheduleItem } from "../payments/schedule";
import { upsertPersonByEmail } from "../people/upsert";
import { afterBookingConfirmed, type ConfirmEffects } from "./afterConfirm";
import { releaseCreditClaim, type PendingPayload } from "./pending";

export interface ConfirmedPayment {
  amountPaidMinor: number;
  presentmentCurrency: string;
  paymentIntentId?: string;
  paymentMethodId?: string;
}

export interface ConfirmOutcome {
  bookingId: string;
  /** False when the pending booking had already been confirmed (a repeat). */
  created: boolean;
  /** The credit claim had lapsed: the booking was confirmed without it. */
  creditLost: boolean;
  /** The gift reservation could not be redeemed: the booking was confirmed without it. */
  giftLost: boolean;
  /** Base-currency amount moved onto a later schedule item because of a lost credit/gift. */
  shiftedBaseMinor: number;
}

export const SCHEDULE_CONSENT_TEXT = "Ef Zin will charge this card on these dates";

/** Raised by redeem_gift_reservation on a late payment whose gift value is gone. */
const GIFT_LOST = /GIFT_INSUFFICIENT|RESERVATION_EXPIRED|RESERVATION_RELEASED/;

/**
 * Turns a pending booking into a booking, in one transaction, then (for a new booking and
 * when `effects` is given) provisions member accounts and sends the emails. Idempotent on
 * `pendingId`: a repeat call returns the booking already created and sends nothing.
 * `payment` is null when gift card and/or credit cover the first payment.
 */
export async function confirmPendingBooking(
  db: SqlClient,
  pendingId: string,
  payment: ConfirmedPayment | null,
  effects?: ConfirmEffects,
): Promise<string> {
  await db.query("begin");
  let outcome: ConfirmOutcome;
  try {
    outcome = await confirmPendingInTx(db, pendingId, payment);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
  if (outcome.created && effects) await afterBookingConfirmed(db, outcome, effects);
  return outcome.bookingId;
}

/**
 * The database part of confirmation. Must run inside the caller's transaction (uses a
 * savepoint). The guest has paid, so this always confirms: a lapsed credit claim or a gift
 * reservation that can no longer be redeemed is left off the booking, flagged in the policy
 * snapshot, and its amount is added to the last unpaid schedule item (or a new item due on
 * the balance due date).
 */
export async function confirmPendingInTx(
  db: SqlClient,
  pendingId: string,
  payment: ConfirmedPayment | null,
  now: Date = new Date(),
): Promise<ConfirmOutcome> {
  const r = await db.query<{ kind: string; payload: PendingPayload | string; confirmed_booking_id: string | null }>(
    "select kind, payload, confirmed_booking_id from pending_bookings where id = $1 for update",
    [pendingId],
  );
  const row = r.rows[0];
  if (!row) throw new Error("PENDING_NOT_FOUND");
  if (row.kind !== "booking") throw new Error(`PENDING_KIND_${row.kind}`);
  if (row.confirmed_booking_id) {
    return { bookingId: row.confirmed_booking_id, created: false, creditLost: false, giftLost: false, shiftedBaseMinor: 0 };
  }
  const p = typeof row.payload === "string" ? (JSON.parse(row.payload) as PendingPayload) : row.payload;

  // The credit is spent only if this checkout still holds its claim (it may have lapsed and been
  // claimed or redeemed by someone else).
  let creditOk = false;
  if (p.credit) {
    const c = await db.query<{ ok: boolean }>(
      `select (claimed_pending_id = $2 and redeemed_booking_id is null and expires_at > now()
               and amount_aed_minor >= $3) as ok
         from credits where id = $1 for update`,
      [p.credit.id, pendingId, p.credit.usedAedMinor],
    );
    creditOk = c.rows[0]?.ok === true;
  }

  // Figures that depend on the gift outcome are written by the update below.
  const b = await db.query<{ id: string }>(
    `insert into bookings
       (booker_person_id, experience_id, status, amount_paid_minor, presentment_currency, base_currency,
        stripe_payment_intent, payment_option, total_price_minor, gift_card_id, schedule_consent_at)
     values ($1, $2, 'deposit_paid', $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      p.booker.personId,
      p.experienceId,
      payment?.amountPaidMinor ?? 0,
      (payment?.presentmentCurrency || p.baseCurrency).toUpperCase(),
      p.baseCurrency,
      payment?.paymentIntentId ?? null,
      p.option,
      p.totalMinor,
      p.gift?.cardId ?? null,
      p.scheduleConsentAt,
    ],
  );
  const bookingId = b.rows[0].id;

  const bookerId = await upsertPersonByEmail(db, p.booker);
  await db.query(
    "insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker) values ($1, $2, $3, true)",
    [bookingId, bookerId, p.booker.ticketTypeId],
  );
  for (const g of p.guests) {
    const personId = await upsertPersonByEmail(db, g);
    await db.query(
      "insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker) values ($1, $2, $3, false)",
      [bookingId, personId, g.ticketTypeId],
    );
  }

  let giftOk = false;
  if (p.gift) {
    await db.query("savepoint gift_redeem");
    try {
      await redeemReservation(db, p.gift.reservationId, bookingId);
      await db.query("release savepoint gift_redeem");
      giftOk = true;
    } catch (err) {
      if (!GIFT_LOST.test(err instanceof Error ? err.message : String(err))) throw err;
      await db.query("rollback to savepoint gift_redeem");
      await releaseReservation(db, p.gift.reservationId);
    }
  }
  const creditLost = p.credit !== null && !creditOk;
  const giftLost = p.gift !== null && !giftOk;
  const lostBase =
    (creditLost ? p.allocation.creditUsedBaseMinor : 0) + (giftLost ? p.allocation.giftUsedBaseMinor : 0);
  const items = await shiftLostAmount(db, p, lostBase, now);
  const unpaidLater = items.some((i) => i.seq > 0 && i.amountMinor > 0);
  const lostAed = (creditLost ? p.credit!.usedAedMinor : 0) + (giftLost ? p.gift!.reservedAedMinor : 0);

  await db.query(
    `update bookings set status = $2, amount_aed_minor = $3, amount_paid_base_minor = $4,
            gift_card_applied_aed_minor = $5, credit_applied_aed_minor = $6, policy_snapshot = $7::jsonb,
            gift_card_applied_base_minor = $8, credit_applied_base_minor = $9
      where id = $1`,
    [
      bookingId,
      unpaidLater ? "deposit_paid" : "paid",
      p.paidNowAedMinor - lostAed,
      items[0].amountMinor + (giftOk ? p.allocation.giftUsedBaseMinor : 0) + (creditOk ? p.allocation.creditUsedBaseMinor : 0),
      giftOk ? p.gift!.reservedAedMinor : 0,
      creditOk ? p.credit!.usedAedMinor : 0,
      JSON.stringify({
        template: p.policy.template,
        copy: p.policy.copy,
        option: p.option,
        schedule: items,
        scheduleConsent: p.scheduleConsentAt ? SCHEDULE_CONSENT_TEXT : null,
        ...(creditLost ? { credit_claim_lost: true } : {}),
        ...(giftLost ? { gift_claim_lost: true } : {}),
      }),
      giftOk ? p.allocation.giftUsedBaseMinor : 0,
      creditOk ? p.allocation.creditUsedBaseMinor : 0,
    ],
  );

  for (const i of items) {
    const paid = i.seq === 0 || i.amountMinor === 0;
    await db.query(
      `insert into payment_schedule_items (booking_id, seq, due_on, amount_minor, currency, status, paid_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [bookingId, i.seq, i.dueOn, i.amountMinor, i.currency, paid ? "paid" : "scheduled", paid ? now.toISOString() : null],
    );
  }

  if (creditOk) await redeemCredit(db, p.credit!.id, bookingId, p.credit!.usedAedMinor, now);

  await db.query(
    `update holds set released_at = now()
      where released_at is null and id in (select unnest(hold_ids) from pending_bookings where id = $1)`,
    [pendingId],
  );
  await releaseCreditClaim(db, pendingId);
  await db.query("update pending_bookings set confirmed_booking_id = $2 where id = $1", [pendingId, bookingId]);
  return { bookingId, created: true, creditLost, giftLost, shiftedBaseMinor: lostBase };
}

/**
 * The schedule to record: the allocated one, plus `lostBase` on the last unpaid item, or on a
 * new item due on the balance due date (today if that has passed) when nothing is left to pay.
 */
async function shiftLostAmount(db: SqlClient, p: PendingPayload, lostBase: number, now: Date): Promise<ScheduleItem[]> {
  const items = [...p.allocation.schedule].sort((a, b) => a.seq - b.seq).map((i) => ({ ...i }));
  if (lostBase <= 0) return items;
  const last = [...items].reverse().find((i) => i.seq > 0 && i.amountMinor > 0);
  if (last) {
    last.amountMinor += lostBase;
    return items;
  }
  const e = await db.query<{ start_at: string | Date | null; balance_due_days: number; timezone: string }>(
    "select start_at, balance_due_days, timezone from experiences where id = $1",
    [p.experienceId],
  );
  const exp = e.rows[0];
  const tz = exp?.timezone ?? "Asia/Dubai";
  const today = calendarDate(now, tz);
  const due = exp?.start_at ? balanceDueDate(new Date(exp.start_at), exp.balance_due_days, tz) : today;
  items.push({
    seq: items[items.length - 1].seq + 1,
    dueOn: due > today ? due : today,
    amountMinor: lostBase,
    currency: items[0].currency,
  });
  return items;
}
