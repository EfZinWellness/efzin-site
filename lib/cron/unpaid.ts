import { dubaiToday } from "../giftcards/dates";
import { cancelOptions } from "../policy/options";
import type { CancelOption, PolicyTemplate } from "../policy/types";
import { adminAddress } from "../requests/handlers";
import type { StripeApi } from "../stripe/client";
import { bookingInvoices, voidOpenInvoices } from "../stripe/invoices";
import { mail, report, type JobContext } from "./context";

/** Days after an unpaid instalment's due date or first charge attempt (the later) before cancelling (Stripe retries, pay links). */
export const UNPAID_GRACE_DAYS = 2;
/** Cancellation notices that failed are retried for this long. */
const NOTICE_RETRY_DAYS = 30;

type BookingFacts = {
  id: string;
  name: string;
  email: string;
  title: string;
  start_at: string | Date | null;
  timezone: string;
  policy_template: string | null;
  policy_snapshot: { template?: string } | string | null;
  amount_paid_base_minor: number | null;
  total_price_minor: number | null;
  amount_aed_minor: number | null;
  base_currency: string | null;
};

const FACTS = `b.id, p.name, p.email, e.title, e.start_at, e.timezone, e.policy_template, b.policy_snapshot,
               b.amount_paid_base_minor, b.total_price_minor, b.amount_aed_minor, b.base_currency`;

/** Refund or credit the policy would give on the amounts actually paid, as a guest cancellation at `at`. */
function moneyBack(b: BookingFacts, at: Date): CancelOption[] {
  if (!b.start_at) return [];
  const snapshot = typeof b.policy_snapshot === "string" ? JSON.parse(b.policy_snapshot) : (b.policy_snapshot ?? {});
  const template = (snapshot.template ?? b.policy_template ?? "standard_retreat") as PolicyTemplate;
  return cancelOptions({
    template,
    startsAt: new Date(b.start_at),
    now: at,
    amountPaidBaseMinor: b.amount_paid_base_minor ?? 0,
    totalPriceBaseMinor: b.total_price_minor ?? 0,
    amountPaidAedMinor: b.amount_aed_minor ?? 0,
    cancelledBy: "guest",
  }).filter((o) => (o.kind === "refund" && o.ratio > 0) || (o.kind === "credit" && o.amountAedMinor > 0));
}

/**
 * Spec §6.3/§9, per the booking's own agreed schedule: a part-paid booking is cancelled (a guest
 * default) only when every unpaid instalment is past due, every one of them was actually
 * attempted (invoiced, or failed), and for each of them UNPAID_GRACE_DAYS have passed since the
 * later of its due date and its first charge attempt (Dubai dates). Never-attempted items are charged late by chargeDueItems instead. Cancelling cancels the
 * unpaid items (never charged afterwards), voids open invoices and frees the spots; money back
 * follows the policy (none at 10 days before a retreat). The notices go out from
 * sendUnpaidCancellationNotices.
 */
export async function cancelUnpaidBookings(ctx: JobContext, stripe: StripeApi | null): Promise<number> {
  const today = dubaiToday(ctx.now);
  const r = await ctx.db.query<BookingFacts>(
    `select ${FACTS}
       from bookings b
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
       join payment_schedule_items i on i.booking_id = b.id and i.status in ('scheduled', 'failed') and i.amount_minor > 0
      where b.status = 'deposit_paid'
      group by b.id, p.id, e.id
     having bool_and(i.due_on < $1::date)
        and bool_and(i.stripe_invoice_id is not null or i.status = 'failed')
        and bool_and(greatest(i.due_on, coalesce(((i.first_attempted_at at time zone 'UTC') + interval '4 hours')::date, i.due_on))
                     + $2::int <= $1::date)
      order by b.created_at`,
    [today, UNPAID_GRACE_DAYS],
  );
  let cancelled = 0;
  for (const b of r.rows) {
    try {
      if (!(await cancelOne(ctx, b.id))) continue;
      cancelled++;
      await afterCancel(ctx, stripe, b);
    } catch (err) {
      await report(ctx, err, `daily_cancel_unpaid_${b.id}`, { bookingId: b.id });
    }
  }
  return cancelled;
}

/** The database part, in one transaction. False when the booking is no longer part paid. */
async function cancelOne(ctx: JobContext, bookingId: string): Promise<boolean> {
  const { db } = ctx;
  await db.query("begin");
  try {
    const s = await db.query<{ status: string }>("select status from bookings where id = $1 for update", [bookingId]);
    if (s.rows[0]?.status !== "deposit_paid") {
      await db.query("commit");
      return false;
    }
    await db.query(
      `update bookings set status = 'cancelled', cancelled_by = 'guest', cancel_reason = 'unpaid_balance', cancelled_at = $2
        where id = $1`,
      [bookingId, ctx.now.toISOString()],
    );
    await db.query(
      "update payment_schedule_items set status = 'cancelled' where booking_id = $1 and status in ('scheduled', 'failed')",
      [bookingId],
    );
    await db.query("commit");
    return true;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

async function afterCancel(ctx: JobContext, stripe: StripeApi | null, b: BookingFacts): Promise<void> {
  const invoices = await bookingInvoices(ctx.db, b.id);
  if (invoices.length > 0) {
    try {
      if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured");
      await voidOpenInvoices(stripe, invoices);
    } catch (err) {
      await report(ctx, err, `daily_cancel_void_${b.id}`, { bookingId: b.id, invoices });
    }
  }
  const back = moneyBack(b, ctx.now);
  if (back.length > 0) {
    // TODO(Task 15): issue it through cancelBooking. Only reachable when the last instalment falls
    // outside the no-refund window (never for standard retreats at 10 days), so Tanya settles it by hand.
    await report(ctx, new Error("Money is due back on a booking cancelled for an unpaid balance"), `unpaid_cancel_refund_${b.id}`, {
      bookingId: b.id,
      options: back,
      amountPaidBaseMinor: b.amount_paid_base_minor,
      currency: b.base_currency,
    });
  }
}

/**
 * `booking_cancelled_unpaid` to the booker and to Tanya for every unpaid-balance cancellation
 * (last 30 days) still missing its email_log row, so a failed send is retried on the next run.
 */
export async function sendUnpaidCancellationNotices(ctx: JobContext): Promise<number> {
  const admin = adminAddress();
  const r = await ctx.db.query<BookingFacts & { cancelled_at: string | Date; unpaid: number; last_due: string | null }>(
    `select ${FACTS}, b.cancelled_at,
            (select coalesce(sum(i.amount_minor), 0)::int from payment_schedule_items i
              where i.booking_id = b.id and i.status = 'cancelled') as unpaid,
            (select to_char(max(i.due_on), 'YYYY-MM-DD') from payment_schedule_items i
              where i.booking_id = b.id and i.status = 'cancelled') as last_due
       from bookings b
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where b.status = 'cancelled' and b.cancel_reason = 'unpaid_balance'
        and b.cancelled_at > $1::timestamptz - make_interval(days => $3::int)
        and (not exists (select 1 from email_log l where l.kind = 'booking_cancelled_unpaid' and l.ref = b.id::text
                          and l."to" = lower(trim(p.email)))
          or not exists (select 1 from email_log l where l.kind = 'booking_cancelled_unpaid' and l.ref = b.id::text
                          and l."to" = lower(trim($2))))
      order by b.cancelled_at`,
    [ctx.now.toISOString(), admin, NOTICE_RETRY_DAYS],
  );
  for (const b of r.rows) {
    const data = {
      experience: b.title,
      startsAt: b.start_at ? new Date(b.start_at).toISOString() : null,
      timezone: b.timezone,
      unpaidMinor: b.unpaid,
      currency: b.base_currency,
      balanceDueOn: b.last_due,
      refundMinor: 0,
      refundDue: moneyBack(b, new Date(b.cancelled_at)).length > 0,
    };
    const facts = { bookingId: b.id };
    await mail(ctx, "booking_cancelled_unpaid", b.email, { ...data, name: b.name }, b.id, facts);
    await mail(
      ctx,
      "booking_cancelled_unpaid",
      admin,
      { ...data, forAdmin: true, booker: `${b.name} <${b.email}>`, bookingId: b.id, amountPaidBaseMinor: b.amount_paid_base_minor },
      b.id,
      facts,
    );
  }
  return r.rows.length;
}
