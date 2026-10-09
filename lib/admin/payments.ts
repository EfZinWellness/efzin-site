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
