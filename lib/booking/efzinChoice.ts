import type { SqlClient } from "../content/sync";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { dubaiToday } from "../giftcards/dates";
import { creditExpiry } from "../policy/credit";
import { adminAddress } from "../requests/handlers";
import type { StripeApi } from "../stripe/client";
import { settleCancellation } from "../stripe/refund";
import { applyMoney, CancelError, type CancelChoice } from "./cancel";
import { loadForCancel, planCancellation } from "./cancelPlan";

/**
 * Ef Zin cancels an experience and each booker chooses what happens to their money (spec §9,
 * owner decision 2026-10-10):
 *
 * 1. cancelForChoice: the booking is cancelled at once (cancelled_by 'efzin', cancel_reason
 *    'efzin_cancelled'), unpaid instalments cancelled, open invoices voided / drafts deleted,
 *    open pay-rest / update-card Checkouts expired, spots freed. No money moves. A
 *    cancellation_choices row (opaque token, deadline CHOICE_DAYS later) is recorded and the
 *    booker is emailed two links, /account/cancellation/<token>?choice=refund|credit; other
 *    guests get the usual "your place is cancelled" note.
 * 2. decideChoice: through the page (decided_by 'guest') or, once the deadline has passed, the
 *    daily job (decided_by 'default', always a refund). Refund: the full amount paid, no fees
 *    deducted, gift part back to the gift card (credit when the card is dead), through the
 *    usual cancellation money path (booking_refunds, retried daily). Credit: the full amount
 *    paid as AED credit (12 months). At most once: a second call reports the choice made.
 */

export const CHOICE_DAYS = 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(["paid", "deposit_paid"]);

export type DecidedBy = "guest" | "default";

export interface ChoiceOffer {
  bookingId: string;
  /** False when the booking was no longer active (nothing done). */
  cancelled: boolean;
  token: string | null;
  /** Stripe steps that failed (voids, expiring sessions); retried by running again. */
  problems: string[];
  /** The booker's refund-or-credit email went out (false: Tanya was alerted; resend from admin). */
  emailSent: boolean;
}

export interface ChoiceDecision {
  outcome: "decided" | "already_decided";
  bookingId: string;
  choice: CancelChoice;
  decidedBy: DecidedBy;
  problems: string[];
}

/** The links in the choice email (no personal data: only the opaque token). */
export const choiceUrl = (origin: string, token: string, choice: CancelChoice) =>
  `${origin}/account/cancellation/${token}?choice=${choice}`;

/** Step 1 for one booking: cancel without moving money and offer the choice. */
export async function cancelForChoice(
  db: SqlClient,
  stripe: StripeApi | null,
  bookingId: string,
  now: Date,
  opts: { sendEmail: SendEmailFn; origin: string },
): Promise<ChoiceOffer> {
  if (!UUID_RE.test(bookingId)) throw new CancelError("not_found");
  let token: string;
  const deadline = new Date(now.getTime() + CHOICE_DAYS * 86_400_000);
  await db.query("begin");
  try {
    const b = await loadForCancel(db, bookingId, now, true);
    if (!b) throw new CancelError("not_found");
    if (!ACTIVE.has(b.status)) {
      await db.query("commit");
      return { bookingId, cancelled: false, token: null, problems: [], emailSent: false };
    }
    await db.query(
      `update bookings set status = 'cancelled', cancelled_by = 'efzin', cancelled_at = $2, cancel_reason = 'efzin_cancelled'
        where id = $1`,
      [bookingId, now.toISOString()],
    );
    await db.query("update payment_schedule_items set status = 'cancelled' where booking_id = $1 and status in ('scheduled', 'failed')", [bookingId]);
    token = (
      await db.query<{ token: string }>(
        "insert into cancellation_choices (booking_id, offered_at, deadline_at) values ($1, $2, $3) returning token",
        [bookingId, now.toISOString(), deadline.toISOString()],
      )
    ).rows[0].token;
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }

  // Nothing to refund yet: this voids invoices and expires open Checkouts.
  const problems = await settleCancellation(db, stripe, bookingId);
  const facts = await emailFacts(db, bookingId);
  const common = { experience: facts.title, startsAt: facts.startsAt, timezone: facts.timezone };
  for (const p of facts.people.filter((x) => !x.isBooker)) {
    await sendQuietly(
      opts.sendEmail,
      "booking_cancelled",
      p.email,
      { ...common, name: p.name, byEfzin: true, forGuest: true, bookerName: facts.bookerName },
      undefined,
      { ref: bookingId, db },
    );
  }
  const emailSent = await sendChoiceEmail(db, opts.sendEmail, bookingId, token, deadline, opts.origin, { ref: bookingId });
  if (!emailSent) {
    await sendQuietly(opts.sendEmail, "admin_error", adminAddress(), {
      context: "efzin_choice_email_failed",
      problem:
        "Ef Zin cancelled this booking, but the email asking the guest to choose a refund or credit could not be sent. Use 'Resend choice email' on the admin Payments page. Without a choice, the guest is refunded in full after 7 days.",
      bookingId,
    });
  }
  return { bookingId, cancelled: true, token, problems, emailSent };
}

/** The booker's refund-or-credit email (links with the token). True when it went out. */
async function sendChoiceEmail(
  db: SqlClient,
  send: SendEmailFn,
  bookingId: string,
  token: string,
  deadline: Date,
  origin: string,
  opts: { ref?: string },
): Promise<boolean> {
  const facts = await emailFacts(db, bookingId);
  const booker = facts.people.find((p) => p.isBooker);
  if (!booker) return false;
  return sendQuietly(
    send,
    "efzin_cancellation_choice",
    booker.email,
    {
      experience: facts.title,
      startsAt: facts.startsAt,
      timezone: facts.timezone,
      name: booker.name,
      amountMinor: facts.paidBase,
      currency: facts.currency,
      creditAedMinor: facts.creditAed,
      giftCardAed: facts.giftAed,
      deadline: dubaiToday(deadline),
      refundUrl: choiceUrl(origin, token, "refund"),
      creditUrl: choiceUrl(origin, token, "credit"),
    },
    undefined,
    opts.ref ? { ref: opts.ref, db } : undefined,
  );
}

/**
 * Admin "Resend choice email": sends the booker's refund-or-credit email again, with the same
 * token, while the choice is still open (no dedupe: Tanya asked for it). False when there is no
 * open choice for the booking or the send failed.
 */
export async function resendChoiceEmail(
  db: SqlClient,
  bookingId: string,
  opts: { sendEmail: SendEmailFn; origin: string },
): Promise<boolean> {
  if (!UUID_RE.test(bookingId)) return false;
  const c = (
    await db.query<{ token: string; deadline_at: string | Date }>(
      "select token, deadline_at from cancellation_choices where booking_id = $1 and choice is null",
      [bookingId],
    )
  ).rows[0];
  if (!c) return false;
  return sendChoiceEmail(db, opts.sendEmail, bookingId, c.token, new Date(c.deadline_at), opts.origin, {});
}

/**
 * Step 2: applies the guest's (or the default) choice for the booking behind `token`. Throws
 * CancelError not_found for an unknown token, stripe_unavailable when card money is due and
 * Stripe is not configured (nothing changes; try again).
 */
export async function decideChoice(
  db: SqlClient,
  stripe: StripeApi | null,
  token: string,
  choice: CancelChoice,
  decidedBy: DecidedBy,
  now: Date,
  opts: { sendEmail?: SendEmailFn } = {},
): Promise<ChoiceDecision> {
  if (!UUID_RE.test(token)) throw new CancelError("not_found");
  let bookingId: string;
  let applied: Awaited<ReturnType<typeof applyMoney>>;
  let plan: Awaited<ReturnType<typeof planCancellation>>;
  await db.query("begin");
  try {
    const c = (
      await db.query<{ booking_id: string; choice: CancelChoice | null; decided_by: DecidedBy | null }>(
        "select booking_id, choice, decided_by from cancellation_choices where token = $1 for update",
        [token],
      )
    ).rows[0];
    if (!c) throw new CancelError("not_found");
    if (c.choice) {
      await db.query("commit");
      return { outcome: "already_decided", bookingId: c.booking_id, choice: c.choice, decidedBy: c.decided_by ?? "guest", problems: [] };
    }
    bookingId = c.booking_id;
    const b = await loadForCancel(db, bookingId, now, true);
    if (!b) throw new CancelError("not_found");
    // Ef Zin's terms: refund in full with no fees, or the whole amount paid as credit.
    plan = await planCancellation(db, stripe, b, choice, "efzin", now);
    await db.query("update bookings set status = $2 where id = $1", [bookingId, plan.status]);
    applied = await applyMoney(db, b, plan, now);
    await db.query(
      "update cancellation_choices set choice = $2, decided_at = $3, decided_by = $4 where booking_id = $1",
      [bookingId, choice, now.toISOString(), decidedBy],
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }

  // The card refunds (a failure is retried by the daily job from booking_refunds).
  const problems = await settleCancellation(db, stripe, bookingId);
  if (opts.sendEmail) {
    const facts = await emailFacts(db, bookingId);
    const booker = facts.people.find((p) => p.isBooker);
    if (booker) {
      await sendQuietly(
        opts.sendEmail,
        "booking_cancelled",
        booker.email,
        {
          experience: facts.title,
          startsAt: facts.startsAt,
          timezone: facts.timezone,
          name: booker.name,
          byEfzin: true,
          chose: choice,
          defaulted: decidedBy === "default",
          cardRefunds: plan.toCardByCharge.map((c) => ({ amountMinor: c.amountMinor, currency: c.currency })),
          feesDeductedMinor: plan.feesDeductedMinor,
          giftCardAed: applied.giftCardAed,
          creditAed: applied.creditAed,
          creditCode: applied.creditCode,
          creditExpiresOn: applied.creditCode ? creditExpiry(now).toISOString().slice(0, 10) : null,
        },
        undefined,
        { ref: `${bookingId}:${choice}`, db },
      );
    }
    if (problems.length > 0) {
      await sendQuietly(opts.sendEmail, "admin_error", adminAddress(), {
        context: "efzin_cancellation_refund_incomplete",
        problem: "A guest's choice after an Ef Zin cancellation was recorded but some Stripe steps failed. The daily job retries the refunds.",
        bookingId,
        problems,
      });
    }
  }
  return { outcome: "decided", bookingId, choice, decidedBy, problems };
}

/**
 * Daily: every choice still open past its deadline becomes a full refund (decided_by
 * 'default'), and the guest is told. Returns how many were decided.
 */
export async function decideOverdueChoices(
  db: SqlClient,
  stripe: StripeApi | null,
  now: Date,
  opts: { sendEmail: SendEmailFn; report: (err: unknown, bookingId: string) => Promise<void> },
): Promise<number> {
  const r = await db.query<{ token: string; booking_id: string }>(
    "select token, booking_id from cancellation_choices where choice is null and deadline_at <= $1 order by deadline_at, booking_id",
    [now.toISOString()],
  );
  let n = 0;
  for (const row of r.rows) {
    try {
      const out = await decideChoice(db, stripe, row.token, "refund", "default", now, { sendEmail: opts.sendEmail });
      if (out.outcome === "decided") n++;
    } catch (err) {
      await opts.report(err, row.booking_id);
    }
  }
  return n;
}

/** What the choice page may show: first name, experience and amounts only (no login needed). */
export interface ChoiceView {
  firstName: string;
  experience: string;
  amountMinor: number;
  currency: string;
  creditAedMinor: number;
  deadlineAt: string;
  choice: CancelChoice | null;
  decidedBy: DecidedBy | null;
}

export async function loadChoiceView(db: SqlClient, token: string): Promise<ChoiceView | null> {
  if (!UUID_RE.test(token)) return null;
  const r = await db.query<{
    name: string; title: string; paid: number | null; currency: string; aed: number | null;
    deadline_at: string | Date; choice: CancelChoice | null; decided_by: DecidedBy | null;
  }>(
    `select p.name, e.title, b.amount_paid_base_minor as paid, coalesce(b.base_currency, e.base_currency) as currency,
            b.amount_aed_minor as aed, c.deadline_at, c.choice, c.decided_by
       from cancellation_choices c
       join bookings b on b.id = c.booking_id
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where c.token = $1`,
    [token],
  );
  const x = r.rows[0];
  if (!x) return null;
  const currency = (x.currency ?? "AED").toUpperCase();
  const paid = x.paid ?? 0;
  return {
    firstName: x.name.trim().split(/\s+/)[0] ?? "",
    experience: x.title,
    amountMinor: paid,
    currency,
    creditAedMinor: currency === "AED" ? paid : (x.aed ?? 0),
    deadlineAt: new Date(x.deadline_at).toISOString(),
    choice: x.choice,
    decidedBy: x.decided_by,
  };
}

/** The booking's facts for the emails, and everyone on it. */
async function emailFacts(db: SqlClient, bookingId: string) {
  const b = (
    await db.query<{
      title: string; start_at: string | Date | null; timezone: string; paid: number | null; currency: string;
      aed: number | null; gift_aed: number; booker: string;
    }>(
      `select e.title, e.start_at, e.timezone, b.amount_paid_base_minor as paid,
              coalesce(b.base_currency, e.base_currency) as currency, b.amount_aed_minor as aed,
              b.gift_card_applied_aed_minor as gift_aed, b.booker_person_id as booker
         from bookings b join experiences e on e.id = b.experience_id where b.id = $1`,
      [bookingId],
    )
  ).rows[0];
  const people = await db.query<{ name: string; email: string; is_booker: boolean }>(
    `select p.name, p.email, (p.id = $2) as is_booker from people p
      where p.id = $2 or p.id in (select person_id from booking_guests where booking_id = $1)
      order by p.email`,
    [bookingId, b.booker],
  );
  const currency = (b.currency ?? "AED").toUpperCase();
  const paidBase = b.paid ?? 0;
  const bookerName = people.rows.find((p) => p.is_booker)?.name ?? "";
  return {
    title: b.title,
    startsAt: b.start_at ? new Date(b.start_at).toISOString() : null,
    timezone: b.timezone,
    paidBase,
    currency,
    creditAed: currency === "AED" ? paidBase : (b.aed ?? 0),
    giftAed: b.gift_aed,
    bookerName,
    people: people.rows.map((p) => ({ name: p.name, email: p.email, isBooker: p.is_booker })),
  };
}
