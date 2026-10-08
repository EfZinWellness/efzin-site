import { dubaiToday } from "../giftcards/dates";
import { balanceDueDate } from "../payments/schedule";
import { cancelOptions } from "../policy/options";
import type { PolicyTemplate } from "../policy/types";
import { adminAddress } from "../requests/handlers";
import type { StripeApi } from "../stripe/client";
import { bookingInvoices, chargeScheduledItem, voidOpenInvoices } from "../stripe/invoices";
import { addDays, mail, report, type JobContext } from "./context";

/** `scheduled_payment_upcoming`, three days before each scheduled instalment of a part-paid booking. */
export async function remindUpcomingPayments(ctx: JobContext): Promise<number> {
  const due = addDays(dubaiToday(ctx.now), 3);
  const r = await ctx.db.query<{
    id: string;
    booking_id: string;
    amount_minor: number;
    currency: string;
    due_on: string;
    remaining: number;
    name: string;
    email: string;
    title: string;
  }>(
    `select i.id, i.booking_id, i.amount_minor, i.currency, to_char(i.due_on, 'YYYY-MM-DD') as due_on,
            (select coalesce(sum(o.amount_minor), 0)::int from payment_schedule_items o
              where o.booking_id = i.booking_id and o.status in ('scheduled', 'failed')) as remaining,
            p.name, p.email, e.title
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where b.status = 'deposit_paid' and i.status = 'scheduled' and i.seq > 0 and i.amount_minor > 0
        and i.due_on = $1::date
      order by b.created_at, i.seq`,
    [due],
  );
  for (const i of r.rows) {
    const page = `${ctx.origin}/account/bookings/${i.booking_id}`;
    await mail(
      ctx,
      "scheduled_payment_upcoming",
      i.email,
      {
        name: i.name,
        experience: i.title,
        amountMinor: i.amount_minor,
        currency: i.currency,
        dueOn: i.due_on,
        remainingAfterMinor: Math.max(0, i.remaining - i.amount_minor),
        payRestUrl: page,
        updateCardUrl: page,
      },
      `${i.id}:${i.due_on}`,
    );
  }
  return r.rows.length;
}

/**
 * Collects the instalments due today (Dubai date) on part-paid bookings, through
 * chargeScheduledItem. Items from earlier days that were never invoiced (a missed run) are
 * collected too; items already invoiced on an earlier day are left to Stripe's retries and the
 * guest's pay link. One item failing is reported and the others still run.
 */
export async function chargeDueItems(ctx: JobContext, stripe: StripeApi | null): Promise<number> {
  const today = dubaiToday(ctx.now);
  const r = await ctx.db.query<{ id: string; booking_id: string }>(
    `select i.id, i.booking_id
       from payment_schedule_items i join bookings b on b.id = i.booking_id
      where b.status = 'deposit_paid' and i.status in ('scheduled', 'failed') and i.seq > 0 and i.amount_minor > 0
        and (i.due_on = $1::date or (i.due_on < $1::date and i.stripe_invoice_id is null))
      order by b.created_at, i.seq`,
    [today],
  );
  if (r.rows.length === 0) return 0;
  if (!stripe) {
    await report(ctx, new Error("STRIPE_SECRET_KEY is not configured"), "daily_charge_unconfigured", { due: r.rows.length });
    return 0;
  }
  let charged = 0;
  for (const i of r.rows) {
    try {
      const out = await chargeScheduledItem(ctx.db, stripe, i.id, ctx.now);
      if (out.status !== "skipped") charged++;
    } catch (err) {
      await report(ctx, err, `daily_charge_${i.id}`, { itemId: i.id, bookingId: i.booking_id });
    }
  }
  return charged;
}

type Unpaid = {
  id: string;
  name: string;
  email: string;
  title: string;
  start_at: string | Date;
  timezone: string;
  balance_due_days: number;
  policy_template: string | null;
  policy_snapshot: { template?: string } | string | null;
  amount_paid_base_minor: number | null;
  total_price_minor: number | null;
  amount_aed_minor: number | null;
  base_currency: string | null;
};

/**
 * Spec §6.3/§9: a booking still part paid after its balance due date (Dubai date) is cancelled
 * as a guest default. Unpaid items are cancelled (never charged afterwards), open invoices voided
 * and the spots freed (cancelled bookings no longer count). Money back follows the policy on the
 * amounts actually paid; at 10 days before a retreat that is nothing.
 */
export async function cancelUnpaidBookings(ctx: JobContext, stripe: StripeApi | null): Promise<number> {
  const today = dubaiToday(ctx.now);
  const r = await ctx.db.query<Unpaid>(
    `select b.id, p.name, p.email, e.title, e.start_at, e.timezone, e.balance_due_days, e.policy_template,
            b.policy_snapshot, b.amount_paid_base_minor, b.total_price_minor, b.amount_aed_minor, b.base_currency
       from bookings b
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where b.status = 'deposit_paid' and e.start_at is not null
        and exists (select 1 from payment_schedule_items i
                     where i.booking_id = b.id and i.status in ('scheduled', 'failed') and i.amount_minor > 0)
      order by b.created_at`,
  );
  let cancelled = 0;
  for (const b of r.rows) {
    const dueOn = balanceDueDate(new Date(b.start_at), b.balance_due_days, b.timezone);
    if (dueOn >= today) continue;
    try {
      const unpaid = await cancelOne(ctx, b.id);
      if (unpaid === null) continue;
      cancelled++;
      await afterCancel(ctx, stripe, b, dueOn, unpaid);
    } catch (err) {
      await report(ctx, err, `daily_cancel_unpaid_${b.id}`, { bookingId: b.id });
    }
  }
  return cancelled;
}

/** The database part, in one transaction. Returns the unpaid amount, or null if no longer part paid. */
async function cancelOne(ctx: JobContext, bookingId: string): Promise<number | null> {
  const { db } = ctx;
  await db.query("begin");
  try {
    const s = await db.query<{ status: string }>("select status from bookings where id = $1 for update", [bookingId]);
    if (s.rows[0]?.status !== "deposit_paid") {
      await db.query("commit");
      return null;
    }
    await db.query("update bookings set status = 'cancelled', cancelled_by = 'guest' where id = $1", [bookingId]);
    const items = await db.query<{ amount_minor: number }>(
      `update payment_schedule_items set status = 'cancelled'
        where booking_id = $1 and status in ('scheduled', 'failed') returning amount_minor`,
      [bookingId],
    );
    await db.query("commit");
    return items.rows.reduce((t, i) => t + i.amount_minor, 0);
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

async function afterCancel(ctx: JobContext, stripe: StripeApi | null, b: Unpaid, dueOn: string, unpaidMinor: number): Promise<void> {
  const invoices = await bookingInvoices(ctx.db, b.id);
  if (invoices.length > 0) {
    if (stripe) {
      try {
        await voidOpenInvoices(stripe, invoices);
      } catch (err) {
        await report(ctx, err, `daily_cancel_void_${b.id}`, { bookingId: b.id, invoices });
      }
    } else {
      await report(ctx, new Error("STRIPE_SECRET_KEY is not configured"), `daily_cancel_void_${b.id}`, { bookingId: b.id, invoices });
    }
  }

  const snapshot = typeof b.policy_snapshot === "string" ? JSON.parse(b.policy_snapshot) : (b.policy_snapshot ?? {});
  const template = (snapshot.template ?? b.policy_template ?? "standard_retreat") as PolicyTemplate;
  const options = cancelOptions({
    template,
    startsAt: new Date(b.start_at),
    now: ctx.now,
    amountPaidBaseMinor: b.amount_paid_base_minor ?? 0,
    totalPriceBaseMinor: b.total_price_minor ?? 0,
    amountPaidAedMinor: b.amount_aed_minor ?? 0,
    cancelledBy: "guest",
  });
  const moneyBack = options.filter((o) => (o.kind === "refund" && o.ratio > 0) || (o.kind === "credit" && o.amountAedMinor > 0));
  if (moneyBack.length > 0) {
    // TODO(Task 15): issue the refund/credit through the cancellation helper once it exists. Only
    // reachable when the balance due date is outside the no-refund window (not for standard
    // retreats with the default 10 days), so for now Tanya settles it by hand.
    await report(ctx, new Error("Money is due back on a booking cancelled for an unpaid balance"), `unpaid_cancel_refund_${b.id}`, {
      bookingId: b.id,
      options: moneyBack,
      amountPaidBaseMinor: b.amount_paid_base_minor,
      currency: b.base_currency,
    });
  }

  const data = {
    experience: b.title,
    startsAt: new Date(b.start_at).toISOString(),
    timezone: b.timezone,
    unpaidMinor,
    currency: b.base_currency,
    balanceDueOn: dueOn,
    refundMinor: 0,
    refundDue: moneyBack.length > 0,
  };
  await mail(ctx, "booking_cancelled_unpaid", b.email, { ...data, name: b.name }, b.id);
  await mail(
    ctx,
    "booking_cancelled_unpaid",
    adminAddress(),
    { ...data, forAdmin: true, booker: `${b.name} <${b.email}>`, bookingId: b.id, amountPaidBaseMinor: b.amount_paid_base_minor },
    b.id,
  );
}
