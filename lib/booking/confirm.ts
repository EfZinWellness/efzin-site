import type { SqlClient } from "../content/sync";
import { redeemCredit } from "../credits/db";
import { redeemReservation } from "../giftcards/db";
import { upsertPersonByEmail } from "../people/upsert";
import type { PendingPayload } from "./pending";

export interface ConfirmedPayment {
  amountPaidMinor: number;
  presentmentCurrency: string;
  paymentIntentId?: string;
  paymentMethodId?: string;
}

export const SCHEDULE_CONSENT_TEXT = "Ef Zin will charge this card on these dates";

/**
 * Turns a pending booking into a booking, in one transaction. Idempotent on `pendingId`:
 * a repeat call returns the booking already created. `payment` is null when gift card
 * and/or credit cover the first payment (no card charge at checkout).
 * Task 11 adds auth provisioning and emails on top of this.
 */
export async function confirmPendingBooking(
  db: SqlClient,
  pendingId: string,
  payment: ConfirmedPayment | null,
): Promise<string> {
  await db.query("begin");
  try {
    const r = await db.query<{ kind: string; payload: PendingPayload; confirmed_booking_id: string | null }>(
      "select kind, payload, confirmed_booking_id from pending_bookings where id = $1 for update",
      [pendingId],
    );
    const row = r.rows[0];
    if (!row) throw new Error("PENDING_NOT_FOUND");
    if (row.kind !== "booking") throw new Error(`PENDING_KIND_${row.kind}`);
    if (row.confirmed_booking_id) {
      await db.query("commit");
      return row.confirmed_booking_id;
    }
    const p = typeof row.payload === "string" ? (JSON.parse(row.payload) as PendingPayload) : row.payload;
    const items = [...p.allocation.schedule].sort((a, b) => a.seq - b.seq);
    const unpaidLater = items.some((i) => i.seq > 0 && i.amountMinor > 0);
    const paidBase = items[0].amountMinor + p.allocation.giftUsedBaseMinor + p.allocation.creditUsedBaseMinor;

    const b = await db.query<{ id: string }>(
      `insert into bookings
         (booker_person_id, experience_id, status, amount_paid_minor, presentment_currency, amount_aed_minor,
          amount_paid_base_minor, base_currency, stripe_payment_intent, policy_snapshot, payment_option,
          total_price_minor, gift_card_id, gift_card_applied_aed_minor, credit_applied_aed_minor, schedule_consent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)
       returning id`,
      [
        p.booker.personId,
        p.experienceId,
        unpaidLater ? "deposit_paid" : "paid",
        payment?.amountPaidMinor ?? 0,
        payment?.presentmentCurrency ?? p.baseCurrency,
        p.paidNowAedMinor,
        paidBase,
        p.baseCurrency,
        payment?.paymentIntentId ?? null,
        JSON.stringify({
          template: p.policy.template,
          copy: p.policy.copy,
          option: p.option,
          schedule: items,
          scheduleConsent: p.scheduleConsentAt ? SCHEDULE_CONSENT_TEXT : null,
        }),
        p.option,
        p.totalMinor,
        p.gift?.cardId ?? null,
        p.gift?.reservedAedMinor ?? 0,
        p.credit?.usedAedMinor ?? 0,
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

    for (const i of items) {
      const paid = i.seq === 0 || i.amountMinor === 0;
      await db.query(
        `insert into payment_schedule_items (booking_id, seq, due_on, amount_minor, currency, status, paid_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [bookingId, i.seq, i.dueOn, i.amountMinor, i.currency, paid ? "paid" : "scheduled", paid ? new Date().toISOString() : null],
      );
    }

    if (p.gift) await redeemReservation(db, p.gift.reservationId, bookingId);
    if (p.credit) await redeemCredit(db, p.credit.id, bookingId, p.credit.usedAedMinor, new Date());

    await db.query(
      `update holds set released_at = now()
        where released_at is null and id in (select unnest(hold_ids) from pending_bookings where id = $1)`,
      [pendingId],
    );
    await db.query("update pending_bookings set confirmed_booking_id = $2 where id = $1", [pendingId, bookingId]);
    await db.query("commit");
    return bookingId;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
