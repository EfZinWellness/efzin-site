import type { SqlClient } from "../content/sync";
import { issueCredit } from "../credits/db";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { GiftReturnError, returnToGiftCard } from "../giftcards/db";
import { creditExpiry } from "../policy/credit";
import { adminAddress } from "../requests/handlers";
import type { StripeApi } from "../stripe/client";
import { settleCancellation } from "../stripe/refund";
import {
  CancelError,
  loadForCancel,
  planCancellation,
  type CancelBookingRow,
  type CancelChoice,
  type CancellationPlan,
  type CancelledBy,
} from "./cancelPlan";
import { notifyWaitlist } from "./waitlist";

export { CancelError, type CancelChoice, type CancellationPlan, type CancelledBy } from "./cancelPlan";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(["paid", "deposit_paid"]);

export interface CancelOptions {
  /** Self-service: only this person (the booker) may cancel. */
  byPersonId?: string;
  /** The fingerprint of the preview the guest confirmed; anything else is refused (`changed`). */
  expectedFingerprint?: string;
  /** Daily job: cancelled for an unpaid balance (allows cancelling with nothing back). */
  reason?: "unpaid_balance";
  /** Only cancel a booking in this status (else nothing happens). */
  requireStatus?: "paid" | "deposit_paid";
  sendEmail?: SendEmailFn;
  origin?: string;
  /** Email the booker (and, for Ef Zin cancellations, every guest). Default true. */
  notifyGuests?: boolean;
  /** Email the waitlist about the freed spots. Default true. */
  notifyWaitlist?: boolean;
  /** Where Stripe problems after the commit go (default: emailed to Tanya). */
  report?: (problems: string[], bookingId: string) => Promise<void>;
}

export interface CancelOutcome {
  bookingId: string;
  /** False when nothing was cancelled by this call (already inactive, or not in `requireStatus`). */
  cancelled: boolean;
  status: string;
  plan: CancellationPlan | null;
  creditCode: string | null;
  problems: string[];
}

/**
 * What cancelling now would give back (the guest sees this before confirming). Same function,
 * same maths as cancelBooking. Reads Stripe (charges and fees) only when card money is due.
 */
export async function previewCancellation(
  db: SqlClient,
  stripe: StripeApi | null,
  bookingId: string,
  choice: CancelChoice,
  now: Date,
  cancelledBy: CancelledBy = "guest",
): Promise<CancellationPlan> {
  if (!UUID_RE.test(bookingId)) throw new CancelError("not_found");
  const b = await loadForCancel(db, bookingId, now, false);
  if (!b) throw new CancelError("not_found");
  if (!ACTIVE.has(b.status)) throw new CancelError("not_active");
  return planCancellation(db, stripe, b, choice, cancelledBy, now);
}

/**
 * Cancels a booking under its policy (re-checked at `now`). In one transaction: booking status
 * (`refunded` / `credited` / `cancelled`), unpaid schedule items cancelled (nothing is ever
 * charged afterwards), gift part returned to the gift card (credit if it can't take it), credit
 * issued, card refunds recorded. Then, after the commit: the card refunds, open invoices voided,
 * open pay-rest / update-card Checkouts expired, the waitlist told about the freed spots, and
 * the guest emailed. Calling it again for a cancelled booking finishes any Stripe step that failed.
 */
export async function cancelBooking(
  db: SqlClient,
  stripe: StripeApi | null,
  bookingId: string,
  choice: CancelChoice,
  cancelledBy: CancelledBy,
  now: Date,
  opts: CancelOptions = {},
): Promise<CancelOutcome> {
  if (!UUID_RE.test(bookingId)) throw new CancelError("not_found");
  let b: CancelBookingRow | null;
  let plan: CancellationPlan;
  let creditCode: string | null = null;
  await db.query("begin");
  try {
    b = await loadForCancel(db, bookingId, now, true);
    if (!b || (opts.byPersonId !== undefined && b.booker_person_id !== opts.byPersonId)) throw new CancelError("not_found");
    if (!ACTIVE.has(b.status) || (opts.requireStatus && b.status !== opts.requireStatus)) {
      await db.query("commit");
      const inactive = !ACTIVE.has(b.status);
      const problems = inactive ? await settleCancellation(db, stripe, bookingId) : [];
      if (problems.length > 0) await reportProblems(opts, problems, bookingId);
      return { bookingId, cancelled: false, status: b.status, plan: null, creditCode: null, problems };
    }
    plan = await planCancellation(db, stripe, b, choice, cancelledBy, now, opts.reason !== undefined);
    if (opts.expectedFingerprint !== undefined && opts.expectedFingerprint !== plan.fingerprint) throw new CancelError("changed");
    creditCode = await applyInDb(db, b, plan, cancelledBy, now, opts.reason ?? null);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }

  const problems = await settleCancellation(db, stripe, bookingId);
  if (opts.sendEmail && opts.notifyWaitlist !== false && cancelledBy === "guest") {
    const tts = await db.query<{ id: string }>("select distinct ticket_type_id as id from booking_guests where booking_id = $1", [bookingId]);
    for (const t of tts.rows) {
      await notifyWaitlist(db, t.id, { sendEmail: opts.sendEmail, origin: opts.origin ?? "", now }).catch((err) =>
        problems.push(`waitlist: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
  if (opts.sendEmail && opts.notifyGuests !== false) await emailGuests(db, opts.sendEmail, b, plan, cancelledBy, creditCode, now);
  if (problems.length > 0) await reportProblems(opts, problems, bookingId);
  return { bookingId, cancelled: true, status: plan.status, plan, creditCode, problems };
}

/** The database writes of a cancellation (caller's transaction). Returns the credit code issued, if any. */
async function applyInDb(
  db: SqlClient,
  b: CancelBookingRow,
  plan: CancellationPlan,
  cancelledBy: CancelledBy,
  now: Date,
  reason: string | null,
): Promise<string | null> {
  await db.query(
    "update bookings set status = $2, cancelled_by = $3, cancelled_at = $4, cancel_reason = $5 where id = $1",
    [b.id, plan.status, cancelledBy, now.toISOString(), reason],
  );
  await db.query("update payment_schedule_items set status = 'cancelled' where booking_id = $1 and status in ('scheduled', 'failed')", [b.id]);
  let creditAed = plan.toCreditAed;
  if (plan.toGiftCardAed > 0 && b.gift_card_id) {
    await db.query("savepoint gift_return");
    try {
      await returnToGiftCard(db, b.gift_card_id, b.id, plan.toGiftCardAed);
      await db.query("release savepoint gift_return");
    } catch (err) {
      // The card died since the preview: the value becomes credit (spec §9).
      if (!(err instanceof GiftReturnError) || err.code !== "GIFT_NOT_RETURNABLE") throw err;
      await db.query("rollback to savepoint gift_return");
      creditAed += plan.toGiftCardAed;
    }
  }
  let code: string | null = null;
  if (creditAed > 0) code = (await issueCredit(db, b.booker_person_id, creditAed, b.id, now)).code;
  for (const [i, c] of plan.toCardByCharge.entries()) {
    await db.query(
      `insert into booking_refunds (booking_id, charge_id, position, amount_minor, currency, fee_deducted_minor)
       values ($1, $2, $3, $4, $5, $6) on conflict (booking_id, charge_id) do nothing`,
      [b.id, c.chargeId, i, c.amountMinor, c.currency, c.feeMinor],
    );
  }
  return code;
}

async function emailGuests(
  db: SqlClient,
  send: SendEmailFn,
  b: CancelBookingRow,
  plan: CancellationPlan,
  cancelledBy: CancelledBy,
  creditCode: string | null,
  now: Date,
): Promise<void> {
  const people = await db.query<{ name: string; email: string; is_booker: boolean }>(
    `select p.name, p.email, (p.id = $2) as is_booker from people p
      where p.id = $2 or p.id in (select person_id from booking_guests where booking_id = $1)`,
    [b.id, b.booker_person_id],
  );
  const common = {
    experience: b.title,
    startsAt: b.start_at ? new Date(b.start_at).toISOString() : null,
    timezone: b.timezone,
    byEfzin: cancelledBy === "efzin",
  };
  for (const p of people.rows) {
    if (!p.is_booker && cancelledBy !== "efzin") continue;
    const data = p.is_booker
      ? {
          ...common,
          name: p.name,
          cardRefunds: plan.toCardByCharge.map((c) => ({ amountMinor: c.amountMinor, currency: c.currency })),
          feesDeductedMinor: plan.feesDeductedMinor,
          giftCardAed: plan.toGiftCardAed,
          creditAed: plan.toCreditAed,
          creditCode,
          creditExpiresOn: creditCode ? creditExpiry(now).toISOString().slice(0, 10) : null,
        }
      : { ...common, name: p.name, forGuest: true };
    await sendQuietly(send, "booking_cancelled", p.email, data, undefined, { ref: b.id, db });
  }
}

async function reportProblems(opts: CancelOptions, problems: string[], bookingId: string): Promise<void> {
  console.error("[cancel] Stripe steps incomplete", bookingId, problems);
  if (opts.report) return opts.report(problems, bookingId);
  if (!opts.sendEmail) return;
  await sendQuietly(opts.sendEmail, "admin_error", adminAddress(), {
    context: "cancellation_incomplete",
    problem: "A booking was cancelled but some Stripe steps failed. They are retried automatically by the daily job; please check if this persists.",
    bookingId,
    problems,
  });
}
