import type { SqlClient } from "../content/sync";

export type AttentionReason = "failed" | "repeated_failures" | "not_attempted";

export interface PaymentItem {
  id: string;
  bookingId: string;
  seq: number;
  /** YYYY-MM-DD */
  dueOn: string;
  amountMinor: number;
  currency: string;
  status: string;
  attempts: number;
  slug: string;
  title: string;
  bookerName: string;
  bookerEmail: string;
  bookerPhone: string | null;
  reasons: AttentionReason[];
}

export interface PaymentsDue {
  today: string;
  /** Scheduled items falling due from today to 30 days ahead, soonest first. */
  dueSoon: PaymentItem[];
  /** Items to chase: failed, failed repeatedly (attempts >= 2), or past due and never attempted. */
  attention: PaymentItem[];
  /** Still to collect per experience: scheduled and failed items on active bookings. */
  toCollect: { slug: string; title: string; currency: string; totalMinor: number }[];
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The calendar date in Dubai, which is when the daily job treats an instalment as due. */
export function dubaiToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function reasonsFor(i: { status: string; attempts: number; dueOn: string; firstAttempted: boolean }, today: string): AttentionReason[] {
  const out: AttentionReason[] = [];
  if (i.status === "failed") out.push("failed");
  if (i.attempts >= 2) out.push("repeated_failures");
  if (i.status === "scheduled" && i.dueOn < today && !i.firstAttempted) out.push("not_attempted");
  return out;
}

export interface UnrefundedPayment {
  /** inactive_invoice: a scheduled payment taken after the booking was cancelled; pay_rest_excess: "Pay the rest now" overpaid. */
  kind: "inactive_invoice" | "pay_rest_excess";
  /** The Stripe invoice id or Checkout session id. */
  ref: string;
  bookingId: string | null;
  slug: string | null;
  title: string | null;
  amountMinor: number;
  currency: string | null;
  /** When the payment was seen (ISO). */
  seenAt: string;
  bookerName: string | null;
  bookerEmail: string | null;
  bookerPhone: string | null;
}

/**
 * Money the site should have given back automatically and has not yet (the refund failed, or
 * for a pay-rest excess without a payment id, cannot be made automatically). The daily job
 * retries the refunds (for 30 days); Tanya refunds by hand whatever stays here and marks it
 * with markRefundedByHand.
 */
export async function loadUnrefunded(db: SqlClient): Promise<UnrefundedPayment[]> {
  const r = await db.query<{
    kind: "inactive_invoice" | "pay_rest_excess"; ref: string; booking_id: string | null; slug: string | null;
    title: string | null; amount: number; currency: string | null; seen_at: string | Date;
    name: string | null; email: string | null; phone: string | null;
  }>(
    `select x.kind, x.ref, x.booking_id, e.slug, e.title, x.amount, x.currency, x.seen_at, p.name, p.email, p.phone
       from (
         select 'inactive_invoice' as kind, invoice_id as ref, booking_id, amount_minor as amount, currency, created_at as seen_at
           from invoice_refunds where refund_id is null
         union all
         select 'pay_rest_excess', session_id, booking_id, excess_minor, currency, created_at
           from pay_rest_settlements where refund_id is null and excess_minor > 0
       ) x
       left join bookings b on b.id = x.booking_id
       left join experiences e on e.id = b.experience_id
       left join people p on p.id = b.booker_person_id
      order by x.seen_at, x.ref`,
  );
  return r.rows.map((x) => ({
    kind: x.kind, ref: x.ref, bookingId: x.booking_id, slug: x.slug, title: x.title, amountMinor: x.amount,
    currency: x.currency ? x.currency.toUpperCase() : null, seenAt: new Date(x.seen_at).toISOString(),
    bookerName: x.name, bookerEmail: x.email, bookerPhone: x.phone,
  }));
}

/**
 * Tanya refunded it herself in Stripe: records `manual:<time>` as the refund id, so the daily job
 * stops retrying and the row leaves the list (no guest notice is sent for it). Only rows still
 * without a refund id; false when there was none.
 */
export async function markRefundedByHand(
  db: SqlClient,
  kind: UnrefundedPayment["kind"],
  ref: string,
  now: Date,
): Promise<boolean> {
  const marker = `manual:${now.toISOString()}`;
  const r =
    kind === "inactive_invoice"
      ? await db.query<{ k: string }>(
          "update invoice_refunds set refund_id = $2 where invoice_id = $1 and refund_id is null returning invoice_id as k",
          [ref, marker],
        )
      : await db.query<{ k: string }>(
          `update pay_rest_settlements set refund_id = $2
            where session_id = $1 and refund_id is null and excess_minor > 0 returning session_id as k`,
          [ref, marker],
        );
  return r.rows.length > 0;
}

export interface CancellationChoiceRow {
  bookingId: string;
  slug: string;
  title: string;
  bookerName: string;
  bookerEmail: string;
  /** Amount paid, in the booking's base currency. */
  amountMinor: number;
  currency: string;
  offeredAt: string;
  deadlineAt: string;
  choice: "refund" | "credit" | null;
  decidedBy: "guest" | "default" | null;
  decidedAt: string | null;
}

/**
 * Ef Zin cancellations awaiting or given the guest's refund-or-credit choice: every open one,
 * and those decided in the last 90 days. Open ones first (soonest deadline), then the latest.
 */
export async function loadCancellationChoices(db: SqlClient): Promise<CancellationChoiceRow[]> {
  const r = await db.query<{
    booking_id: string; slug: string; title: string; name: string; email: string; paid: number | null; currency: string;
    offered_at: string | Date; deadline_at: string | Date; choice: "refund" | "credit" | null;
    decided_by: "guest" | "default" | null; decided_at: string | Date | null;
  }>(
    `select c.booking_id, e.slug, e.title, p.name, p.email, b.amount_paid_base_minor as paid,
            coalesce(b.base_currency, e.base_currency) as currency, c.offered_at, c.deadline_at, c.choice, c.decided_by, c.decided_at
       from cancellation_choices c
       join bookings b on b.id = c.booking_id
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where c.choice is null or c.decided_at > now() - interval '90 days'
      order by (c.choice is not null), case when c.choice is null then c.deadline_at end, c.decided_at desc, c.booking_id`,
  );
  const iso = (v: string | Date) => new Date(v).toISOString();
  return r.rows.map((x) => ({
    bookingId: x.booking_id,
    slug: x.slug,
    title: x.title,
    bookerName: x.name,
    bookerEmail: x.email,
    amountMinor: x.paid ?? 0,
    currency: (x.currency ?? "AED").toUpperCase(),
    offeredAt: iso(x.offered_at),
    deadlineAt: iso(x.deadline_at),
    choice: x.choice,
    decidedBy: x.decided_by,
    decidedAt: x.decided_at ? iso(x.decided_at) : null,
  }));
}

export async function loadPaymentsDue(db: SqlClient, today: string): Promise<PaymentsDue> {
  const r = await db.query<{
    id: string; booking_id: string; seq: number; due_on: string; amount_minor: number; currency: string;
    status: string; attempts: number; first_attempted: boolean; slug: string; title: string;
    name: string; email: string; phone: string | null;
  }>(
    `select i.id, i.booking_id, i.seq, to_char(i.due_on, 'YYYY-MM-DD') as due_on, i.amount_minor, i.currency,
            i.status, i.attempts, (i.first_attempted_at is not null) as first_attempted,
            e.slug, e.title, p.name, p.email, p.phone
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where b.status in ('paid', 'deposit_paid') and i.status in ('scheduled', 'failed')
      order by i.due_on, i.seq, i.id`,
  );
  const horizon = addDays(today, 30);
  const items: PaymentItem[] = r.rows.map((x) => ({
    id: x.id, bookingId: x.booking_id, seq: x.seq, dueOn: x.due_on, amountMinor: x.amount_minor, currency: x.currency,
    status: x.status, attempts: x.attempts, slug: x.slug, title: x.title,
    bookerName: x.name, bookerEmail: x.email, bookerPhone: x.phone,
    reasons: reasonsFor({ status: x.status, attempts: x.attempts, dueOn: x.due_on, firstAttempted: x.first_attempted }, today),
  }));

  const totals = new Map<string, { slug: string; title: string; currency: string; totalMinor: number }>();
  for (const i of items) {
    const key = `${i.slug}|${i.currency}`;
    const t = totals.get(key) ?? { slug: i.slug, title: i.title, currency: i.currency, totalMinor: 0 };
    t.totalMinor += i.amountMinor;
    totals.set(key, t);
  }

  return {
    today,
    attention: items.filter((i) => i.reasons.length > 0),
    dueSoon: items.filter((i) => i.reasons.length === 0 && i.status === "scheduled" && i.dueOn >= today && i.dueOn <= horizon),
    toCollect: [...totals.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}
