import type Stripe from "stripe";
import { cancelBooking } from "../booking/cancel";
import { dubaiToday } from "../giftcards/dates";
import { adminAddress } from "../requests/handlers";
import { pendingAutoRefunds, refundInactiveInvoiceNow, refundNotices, refundPayRestExcessNow } from "../stripe/autoRefunds";
import type { StripeApi } from "../stripe/client";
import type { AfterCommit } from "../stripe/events";
import { onInvoicePaid } from "../stripe/invoiceEvents";
import { settleCancellation } from "../stripe/refund";
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
  amount_paid_base_minor: number | null;
  base_currency: string | null;
};

const FACTS = `b.id, p.name, p.email, e.title, e.start_at, e.timezone, b.amount_paid_base_minor, b.base_currency`;

/**
 * Spec §6.3/§9, per the booking's own agreed schedule: a part-paid booking is cancelled (a guest
 * default) only when every unpaid instalment is past due, every one of them was actually
 * attempted (charged with an answer from Stripe, pay link sent, or failed), and for each of them UNPAID_GRACE_DAYS have passed since the
 * later of its due date and its first charge attempt (Dubai dates). Never-attempted items are charged late by chargeDueItems instead. Cancelling cancels the
 * unpaid items (never charged afterwards), voids open invoices and frees the spots; money back
 * follows the policy (none at 10 days before a retreat). The notices go out from
 * sendUnpaidCancellationNotices.
 */
export async function cancelUnpaidBookings(
  ctx: JobContext,
  stripe: StripeApi | null,
  usdRates?: () => Promise<Record<string, number>>,
): Promise<number> {
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
        and bool_and(i.first_attempted_at is not null or i.status = 'failed')
        and bool_and(greatest(i.due_on, coalesce(((i.first_attempted_at at time zone 'UTC') + interval '4 hours')::date, i.due_on))
                     + $2::int <= $1::date)
      order by b.created_at`,
    [today, UNPAID_GRACE_DAYS],
  );
  let cancelled = 0;
  for (const b of r.rows) {
    try {
      // Stripe is the truth for invoices already sent: one paid while its webhook is late is
      // recorded here, and the booking is left for the next run (never cancelled on stale data).
      if ((await checkInvoicesInStripe(ctx, stripe, b.id, usdRates)) !== "unpaid") continue;
      // The guest-cancellation path and maths (policy money back on the amounts paid, as a guest
      // cancelling now), only while the booking is still part paid. The notices go out below.
      const out = await cancelBooking(ctx.db, stripe, b.id, "refund", "guest", ctx.now, {
        reason: "unpaid_balance",
        // Refund if the policy offers one, else credit if offered (e.g. an event within 48 hours).
        creditFallback: true,
        requireStatus: "deposit_paid",
        sendEmail: ctx.sendEmail,
        origin: ctx.origin,
        notifyGuests: false,
        report: async (problems, bookingId) => {
          await report(ctx, new Error(problems.join("; ")), `daily_cancel_stripe_${bookingId}`, { bookingId, problems });
        },
      });
      if (out.cancelled) cancelled++;
    } catch (err) {
      await report(ctx, err, `daily_cancel_unpaid_${b.id}`, { bookingId: b.id });
    }
  }
  return cancelled;
}

/**
 * Before an unpaid-balance cancellation: every unpaid item that already has a Stripe invoice is
 * looked up in Stripe. "unpaid": none of them is paid, go ahead. "paid": at least one was paid
 * (its invoice.paid webhook is late or lost); it is recorded through the webhook's own path
 * (onInvoicePaid: item paid, booking paid when nothing is left, receipt; a later webhook for the
 * same invoice then does nothing), or Tanya is told when it cannot be matched, and the booking is
 * not cancelled in this run. "unknown": Stripe could not be asked; not cancelled in this run.
 */
async function checkInvoicesInStripe(
  ctx: JobContext,
  stripe: StripeApi | null,
  bookingId: string,
  usdRates?: () => Promise<Record<string, number>>,
): Promise<"unpaid" | "paid" | "unknown"> {
  const items = await ctx.db.query<{ id: string; stripe_invoice_id: string }>(
    `select id, stripe_invoice_id from payment_schedule_items
      where booking_id = $1 and status in ('scheduled', 'failed') and amount_minor > 0 and stripe_invoice_id is not null
      order by seq`,
    [bookingId],
  );
  if (items.rows.length === 0) return "unpaid";
  if (!stripe) {
    await report(ctx, new Error("STRIPE_SECRET_KEY is not configured: invoices not checked, booking not cancelled"), "daily_cancel_check_invoices", { bookingId });
    return "unknown";
  }
  let paid = false;
  for (const it of items.rows) {
    let inv: Awaited<ReturnType<StripeApi["invoices"]["retrieve"]>>;
    try {
      inv = await stripe.invoices.retrieve(it.stripe_invoice_id);
    } catch (err) {
      await report(ctx, err, "daily_cancel_check_invoices", { bookingId, invoiceId: it.stripe_invoice_id });
      return "unknown";
    }
    if (inv.status !== "paid") continue;
    paid = true;
    let after: AfterCommit | void;
    await ctx.db.query("begin");
    try {
      after = await onInvoicePaid(
        { amount_paid: inv.total, currency: "", metadata: null, ...inv } as unknown as Stripe.Invoice,
        { db: ctx.db, stripe, sendEmail: ctx.sendEmail, auth: null, origin: ctx.origin, now: ctx.now, usdRates },
      );
      await ctx.db.query("commit");
    } catch (err) {
      await ctx.db.query("rollback").catch(() => {});
      throw err;
    }
    if (after) await after();
    const now = await ctx.db.query<{ status: string }>("select status from payment_schedule_items where id = $1", [it.id]);
    if (now.rows[0]?.status !== "paid") {
      await report(ctx, new Error(`Invoice ${inv.id} is paid in Stripe but could not be recorded on item ${it.id}`), `daily_cancel_paid_invoice_${it.id}`, {
        bookingId,
        invoiceId: inv.id,
        problem: "A booking was due to be cancelled for an unpaid balance, but Stripe shows this instalment as paid. The booking was kept; please check it.",
      });
    }
  }
  return paid ? "paid" : "unpaid";
}

/**
 * Card refunds of a cancellation that failed (Stripe error) are retried every day for 30 days,
 * through the same recorded amounts and idempotency keys. Returns how many bookings were retried.
 */
export async function finishPendingRefunds(ctx: JobContext, stripe: StripeApi | null): Promise<number> {
  const r = await ctx.db.query<{ booking_id: string }>(
    `select distinct booking_id from booking_refunds
      where refund_id is null and created_at > $1::timestamptz - interval '30 days'`,
    [ctx.now.toISOString()],
  );
  for (const { booking_id } of r.rows) {
    const problems = await settleCancellation(ctx.db, stripe, booking_id);
    if (problems.length > 0) {
      await report(ctx, new Error(problems.join("; ")), `daily_refund_retry_${booking_id}`, { bookingId: booking_id, problems });
    }
  }
  return r.rows.length;
}

/**
 * Automatic refunds outside a cancellation that failed when first tried (a payment taken on an
 * inactive booking, a pay-rest excess) are retried every day until they go through, through
 * the stored amounts, the same idempotency keys and adoption of an earlier refund. Until then
 * /admin/payments lists them. Returns how many were refunded in this run.
 */
export async function retryAutoRefunds(ctx: JobContext, stripe: StripeApi | null): Promise<number> {
  const { invoices, payRest } = await pendingAutoRefunds(ctx.db);
  if (invoices.length + payRest.length === 0) return 0;
  if (!stripe) {
    await report(ctx, new Error("STRIPE_SECRET_KEY is not configured: automatic refunds not retried"), "daily_auto_refunds", {
      invoices: invoices.map((r) => r.invoice_id),
      sessions: payRest.map((r) => r.session_id),
    });
    return 0;
  }
  let done = 0;
  for (const row of invoices) {
    try {
      await refundInactiveInvoiceNow(ctx.db, stripe, row);
      done++;
    } catch (err) {
      await report(ctx, err, `daily_auto_refund_${row.invoice_id}`, { bookingId: row.booking_id, invoiceId: row.invoice_id });
    }
  }
  for (const row of payRest) {
    try {
      await refundPayRestExcessNow(ctx.db, stripe, row);
      done++;
    } catch (err) {
      await report(ctx, err, `daily_auto_refund_${row.session_id}`, { bookingId: row.booking_id, session: row.session_id });
    }
  }
  return done;
}

/**
 * "We've refunded your payment" to the booker for every automatic refund not yet emailed
 * (email_log ref = refund id): refunds made by the retry above, and notices whose first send
 * failed. (No time window: the tables hold no refund time, and a refund made late by the retry
 * must still be announced.) Returns how many were sent.
 */
export async function sendAutoRefundNotices(ctx: JobContext): Promise<number> {
  let n = 0;
  for (const notice of await refundNotices(ctx.db, {})) {
    if (await mail(ctx, "payment_refunded", notice.to, notice.data, notice.refundId, { bookingId: notice.data.bookingId })) n++;
  }
  return n;
}

/**
 * `booking_cancelled_unpaid` to the booker and to Tanya for every unpaid-balance cancellation
 * (last 30 days) still missing its email_log row, so a failed send is retried on the next run.
 */
export async function sendUnpaidCancellationNotices(ctx: JobContext): Promise<number> {
  const admin = adminAddress();
  const r = await ctx.db.query<
    BookingFacts & {
      cancelled_at: string | Date;
      unpaid: number;
      last_due: string | null;
      refund: number;
      refund_currency: string | null;
      credit_aed: number;
      credit_code: string | null;
      credit_expires: string | null;
    }
  >(
    `select ${FACTS}, b.cancelled_at,
            (select coalesce(sum(i.amount_minor), 0)::int from payment_schedule_items i
              where i.booking_id = b.id and i.status = 'cancelled') as unpaid,
            (select to_char(max(i.due_on), 'YYYY-MM-DD') from payment_schedule_items i
              where i.booking_id = b.id and i.status = 'cancelled') as last_due,
            (select coalesce(sum(f.amount_minor), 0)::int from booking_refunds f where f.booking_id = b.id) as refund,
            (select case when count(distinct f.currency) = 1 then min(f.currency) end from booking_refunds f
              where f.booking_id = b.id) as refund_currency,
            (select coalesce(sum(c.amount_aed_minor), 0)::int from credits c where c.source_booking_id = b.id) as credit_aed,
            (select min(c.code) from credits c where c.source_booking_id = b.id) as credit_code,
            (select to_char(min(c.expires_at) at time zone 'Asia/Dubai', 'YYYY-MM-DD') from credits c
              where c.source_booking_id = b.id) as credit_expires
       from bookings b
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where b.status in ('cancelled', 'refunded', 'credited') and b.cancel_reason = 'unpaid_balance'
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
      // The card refund made by the cancellation (policy money back), when in one currency.
      refundMinor: b.refund_currency ? b.refund : 0,
      refundCurrency: b.refund_currency,
      refundDue: b.refund > 0 && !b.refund_currency,
      creditAed: b.credit_aed,
      creditExpiresOn: b.credit_expires,
    };
    const facts = { bookingId: b.id };
    await mail(ctx, "booking_cancelled_unpaid", b.email, { ...data, name: b.name, creditCode: b.credit_code }, b.id, facts);
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
