import type { SqlClient } from "../content/sync";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { refId, type StripeApi } from "./client";

/**
 * The two automatic refunds the site makes outside a cancellation: a scheduled payment taken
 * after its booking stopped being active (invoice_refunds), and what a "Pay the rest now"
 * payment no longer covered (pay_rest_settlements.excess_minor). Each is made at most once: the
 * idempotency key is fixed per invoice / session and the params come from the stored row, and a
 * refund Stripe already has with our metadata is adopted, so a retry long after Stripe's 24-hour
 * key window cannot refund twice. The refund id is stored once made. The webhook makes the first
 * attempt; the daily job retries any row still without a refund id.
 */

export interface InactiveInvoiceRefund {
  invoice_id: string;
  booking_id: string | null;
  amount_minor: number;
}

export interface PayRestExcessRefund {
  session_id: string;
  booking_id: string | null;
  payment_intent: string;
  excess_minor: number;
}

const live = (r: { status: string | null }) => r.status !== "failed" && r.status !== "canceled";

/**
 * What an automatic refund attempt did. `created`: refunded now; `adopted`: a refund Stripe
 * already had (ours by metadata, or one of exactly this amount made after the payment was seen,
 * e.g. by hand in the dashboard); `already_refunded`: the charge already shows at least this
 * much refunded without a matching refund, so nothing was refunded, a marker
 * (`already_refunded:<time>`) was stored and Tanya must check.
 */
export interface AutoRefundResult {
  id: string;
  outcome: "created" | "adopted" | "already_refunded";
}

/** Tanya's instructions for a failed automatic refund (alerts and /admin/payments). */
export const RETRY_COPY =
  "We'll retry automatically each morning. If you refund it yourself in Stripe, press 'Mark refunded by hand' here.";

/** Prefix of the refund_id stored when the charge was already refunded (no refund made by the site). */
export const ALREADY_REFUNDED = "already_refunded:";
/** Prefix of the refund_id stored when Tanya marked a refund as made by hand. */
export const MANUAL_REFUND = "manual:";

/**
 * The guard against refunding twice (N1), then the refund. `seenAt` is when the payment needing
 * the refund was recorded; a refund without our metadata only counts when it is for exactly
 * `amount` and was made at or after that time.
 */
async function refundOnce(
  stripe: StripeApi,
  a: {
    pi: string;
    amount: number;
    seenAt: Date | null;
    ours: (md: Record<string, string>) => boolean;
    metadata: Record<string, string>;
    idempotencyKey: string;
    now: Date;
  },
): Promise<AutoRefundResult> {
  const refunds = (await stripe.refunds.list({ payment_intent: a.pi, limit: 100 })).data.filter(live);
  const earlier = refunds.find((r) => a.ours((r.metadata ?? {}) as Record<string, string>));
  if (earlier) return { id: earlier.id, outcome: "adopted" };
  const since = a.seenAt ? Math.floor(a.seenAt.getTime() / 1000) : Number.POSITIVE_INFINITY;
  // A refund with our metadata kind is one of the site's own other refunds (e.g. a cancellation),
  // never one made by hand for this amount.
  const byHand = refunds.find((r) => !r.metadata?.kind && r.amount === a.amount && r.created >= since);
  if (byHand) return { id: byHand.id, outcome: "adopted" };
  const charges = (await stripe.charges.list({ payment_intent: a.pi, limit: 100 })).data.filter((c) => c.status === "succeeded");
  const refunded = charges.reduce((s, c) => s + c.amount_refunded, 0);
  if (refunded >= a.amount) return { id: `${ALREADY_REFUNDED}${a.now.toISOString()}`, outcome: "already_refunded" };
  const refund = await stripe.refunds.create(
    { payment_intent: a.pi, amount: a.amount, metadata: a.metadata },
    { idempotencyKey: a.idempotencyKey },
  );
  return { id: refund.id, outcome: "created" };
}

const seenAt = async (db: SqlClient, sql: string, key: string): Promise<Date | null> => {
  const r = await db.query<{ t: string | Date | null }>(sql, [key]);
  const t = r.rows[0]?.t;
  return t ? new Date(t) : null;
};

/** Refunds a scheduled-payment invoice in full (unless already refunded) and stores the refund id or marker. */
export async function refundInactiveInvoiceNow(
  db: SqlClient,
  stripe: StripeApi,
  row: InactiveInvoiceRefund,
  now = new Date(),
): Promise<AutoRefundResult> {
  const metadata = { kind: "inactive_invoice", booking_id: row.booking_id ?? "", invoice_id: row.invoice_id };
  const payments = await stripe.invoicePayments.list({ invoice: row.invoice_id, status: "paid", limit: 10 });
  const pi = refId(payments.data[0]?.payment.payment_intent ?? null);
  if (!pi) throw new Error(`No payment found for invoice ${row.invoice_id}`);
  const out = await refundOnce(stripe, {
    pi,
    amount: row.amount_minor,
    seenAt: await seenAt(db, "select created_at as t from invoice_refunds where invoice_id = $1", row.invoice_id),
    ours: (md) => md.kind === metadata.kind && md.invoice_id === row.invoice_id,
    metadata,
    idempotencyKey: `efzin-inactive-invoice-refund-${row.invoice_id}`,
    now,
  });
  await db.query("update invoice_refunds set refund_id = $2 where invoice_id = $1 and refund_id is null", [row.invoice_id, out.id]);
  return out;
}

/** Refunds a pay-rest excess (unless already refunded) and stores the refund id or marker. */
export async function refundPayRestExcessNow(
  db: SqlClient,
  stripe: StripeApi,
  row: PayRestExcessRefund,
  now = new Date(),
): Promise<AutoRefundResult> {
  const metadata = { kind: "pay_rest_excess", booking_id: row.booking_id ?? "", session_id: row.session_id };
  const out = await refundOnce(stripe, {
    pi: row.payment_intent,
    amount: row.excess_minor,
    seenAt: await seenAt(db, "select created_at as t from pay_rest_settlements where session_id = $1", row.session_id),
    ours: (md) => md.kind === metadata.kind && md.session_id === row.session_id,
    metadata,
    idempotencyKey: `efzin-payrest-refund-${row.session_id}`,
    now,
  });
  await db.query("update pay_rest_settlements set refund_id = $2 where session_id = $1 and refund_id is null", [row.session_id, out.id]);
  return out;
}

export interface RefundNotice {
  refundId: string;
  to: string;
  data: { name: string; experience: string; amountMinor: number; currency: string | null; reason: RefundReason; bookingId: string };
}

/** Why the money went back: payment after cancellation, pay-rest overpaid, pay-rest after cancellation. */
export type RefundReason = "inactive_invoice" | "pay_rest_excess" | "pay_rest_inactive";

/**
 * Guest notices ("we've refunded your payment of X") for automatic refunds already made and not
 * yet emailed (email_log kind payment_refunded, ref = refund id): one refund with `refundId`, or
 * every one made since `since`.
 */
export async function refundNotices(db: SqlClient, opts: { refundId?: string; since?: Date }): Promise<RefundNotice[]> {
  const r = await db.query<{
    refund_id: string; reason: RefundReason; amount: number; currency: string | null;
    name: string; email: string; title: string; booking_id: string;
  }>(
    `select x.refund_id, x.reason, x.amount, x.currency, p.name, p.email, e.title, b.id as booking_id
       from (
         select refund_id, 'inactive_invoice' as reason, amount_minor as amount, currency, booking_id, created_at
           from invoice_refunds where refund_id is not null
         union all
         select refund_id,
                case when booking_status in ('deposit_paid', 'paid') then 'pay_rest_excess' else 'pay_rest_inactive' end,
                excess_minor, currency, booking_id, created_at
           from pay_rest_settlements where refund_id is not null and excess_minor > 0
       ) x
       join bookings b on b.id = x.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where ($1::text is null or x.refund_id = $1)
        -- Only refunds the site made or adopted: not a marker for one done by hand or found already refunded.
        and x.refund_id not like 'manual:%' and x.refund_id not like 'already_refunded:%'
        and ($2::timestamptz is null or x.created_at > $2::timestamptz)
        and not exists (select 1 from email_log l where l.kind = 'payment_refunded' and l.ref = x.refund_id
                          and l."to" = lower(trim(p.email)))
      order by x.created_at, x.refund_id`,
    [opts.refundId ?? null, opts.since?.toISOString() ?? null],
  );
  return r.rows.map((x) => ({
    refundId: x.refund_id,
    to: x.email,
    data: {
      name: x.name,
      experience: x.title,
      amountMinor: x.amount,
      currency: x.currency ? x.currency.toUpperCase() : null,
      reason: x.reason,
      bookingId: x.booking_id,
    },
  }));
}

/** Emails the guest about one automatic refund (at most once: email_log ref = refund id). Never throws. */
export async function sendRefundNotice(db: SqlClient, send: SendEmailFn, refundId: string): Promise<void> {
  try {
    for (const n of await refundNotices(db, { refundId })) {
      await sendQuietly(send, "payment_refunded", n.to, n.data, undefined, { ref: n.refundId, db });
    }
  } catch (err) {
    console.error("[refund] guest notice failed", refundId, err);
  }
}

/**
 * Rows still owed an automatic refund (the daily job retries these; /admin/payments lists them),
 * with when the payment was seen (the retries stop after AUTO_REFUND_RETRY_DAYS).
 */
export async function pendingAutoRefunds(
  db: SqlClient,
): Promise<{
  invoices: (InactiveInvoiceRefund & { created_at: Date; currency: string | null })[];
  payRest: (PayRestExcessRefund & { created_at: Date; currency: string | null })[];
}> {
  const inv = await db.query<InactiveInvoiceRefund & { created_at: string | Date; currency: string | null }>(
    "select invoice_id, booking_id, amount_minor, currency, created_at from invoice_refunds where refund_id is null order by created_at, invoice_id",
  );
  const rest = await db.query<PayRestExcessRefund & { created_at: string | Date; currency: string | null }>(
    `select session_id, booking_id, payment_intent, excess_minor, currency, created_at from pay_rest_settlements
      where refund_id is null and excess_minor > 0 and payment_intent is not null
      order by created_at, session_id`,
  );
  return {
    invoices: inv.rows.map((r) => ({ ...r, created_at: new Date(r.created_at) })),
    payRest: rest.rows.map((r) => ({ ...r, created_at: new Date(r.created_at) })),
  };
}

/** Failed automatic refunds are retried daily for this long after the payment was seen. */
export const AUTO_REFUND_RETRY_DAYS = 30;
