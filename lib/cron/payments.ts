import { dubaiToday } from "../giftcards/dates";
import { refId, type StripeApi } from "../stripe/client";
import { chargeScheduledItem } from "../stripe/invoices";
import { addDays, mail, report, type JobContext } from "./context";

/** Last four digits of the customer's default card, or null (no card, no Stripe, or any error). */
async function cardLast4(stripe: StripeApi | null, customer: string | null, cache: Map<string, string | null>): Promise<string | null> {
  if (!stripe || !customer) return null;
  if (cache.has(customer)) return cache.get(customer)!;
  let last4: string | null = null;
  try {
    const c = await stripe.customers.retrieve(customer);
    const pm = c.deleted ? null : refId(c.invoice_settings?.default_payment_method ?? null);
    if (pm) last4 = (await stripe.paymentMethods.retrieve(pm)).card?.last4 ?? null;
  } catch (err) {
    console.error(`[cron] could not read the saved card of ${customer}`, err);
  }
  cache.set(customer, last4);
  return last4;
}

/** `scheduled_payment_upcoming`, three days before each scheduled instalment of a part-paid booking. */
export async function remindUpcomingPayments(ctx: JobContext, stripe: StripeApi | null): Promise<number> {
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
    stripe_customer_id: string | null;
    title: string;
  }>(
    `select i.id, i.booking_id, i.amount_minor, i.currency, to_char(i.due_on, 'YYYY-MM-DD') as due_on,
            (select coalesce(sum(o.amount_minor), 0)::int from payment_schedule_items o
              where o.booking_id = i.booking_id and o.status in ('scheduled', 'failed')) as remaining,
            p.name, p.email, p.stripe_customer_id, e.title
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where b.status = 'deposit_paid' and i.status = 'scheduled' and i.seq > 0 and i.amount_minor > 0
        and i.due_on = $1::date
      order by b.created_at, i.seq`,
    [due],
  );
  const cards = new Map<string, string | null>();
  for (const i of r.rows) {
    const page = `${ctx.origin}/account/bookings/${i.booking_id}`;
    const last4 = await cardLast4(stripe, i.stripe_customer_id, cards);
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
        ...(last4 ? { cardLast4: last4 } : {}),
        payRestUrl: page,
        updateCardUrl: page,
      },
      `${i.id}:${i.due_on}`,
      { bookingId: i.booking_id, itemId: i.id },
    );
  }
  return r.rows.length;
}

/** "INVOICE_TOTAL_MISMATCH: …" → INVOICE_TOTAL_MISMATCH; a Stripe error → its type; else UNEXPECTED. */
function errorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /^([A-Z][A-Z0-9_]{2,})\b/.exec(msg);
  if (m) return m[1];
  const type = (err as { type?: unknown } | null)?.type;
  return typeof type === "string" && /^\w+$/.test(type) ? type : "UNEXPECTED";
}

/**
 * Collects the instalments due today (Dubai date) on part-paid bookings, through
 * chargeScheduledItem. With `catchUp`, items from earlier days that were never invoiced (a missed
 * run, a Stripe outage) are collected late too; items already invoiced earlier are left to
 * Stripe's retries and the guest's pay link. A failing item never stops the others; failures
 * are emailed to Tanya once per run per error code, listing the items.
 */
export async function chargeDueItems(ctx: JobContext, stripe: StripeApi | null, opts: { catchUp: boolean }): Promise<number> {
  const today = dubaiToday(ctx.now);
  const r = await ctx.db.query<{ id: string; booking_id: string }>(
    `select i.id, i.booking_id
       from payment_schedule_items i join bookings b on b.id = i.booking_id
      where b.status = 'deposit_paid' and i.status in ('scheduled', 'failed') and i.seq > 0 and i.amount_minor > 0
        and (i.due_on = $1::date or ($2 and i.due_on < $1::date and i.stripe_invoice_id is null))
      order by b.created_at, i.seq`,
    [today, opts.catchUp],
  );
  if (r.rows.length === 0) return 0;
  if (!stripe) {
    await report(ctx, new Error("STRIPE_SECRET_KEY is not configured"), "daily_charge_unconfigured", {
      itemIds: r.rows.map((i) => i.id),
    });
    return 0;
  }
  let charged = 0;
  const failures = new Map<string, { itemId: string; bookingId: string; error: string }[]>();
  for (const i of r.rows) {
    try {
      const out = await chargeScheduledItem(ctx.db, stripe, i.id, ctx.now);
      if (out.status !== "skipped") charged++;
    } catch (err) {
      console.error(`[cron] charging item ${i.id} failed`, err);
      const code = errorCode(err);
      failures.set(code, [
        ...(failures.get(code) ?? []),
        { itemId: i.id, bookingId: i.booking_id, error: err instanceof Error ? err.message : String(err) },
      ]);
    }
  }
  for (const [code, list] of failures) {
    await report(ctx, new Error(`${code}: ${list.length} scheduled payment(s) could not be charged`), `daily_charge_${code}`, {
      itemIds: list.map((f) => f.itemId),
      bookingIds: list.map((f) => f.bookingId),
      errors: list.map((f) => `${f.itemId}: ${f.error}`),
    });
  }
  return charged;
}
