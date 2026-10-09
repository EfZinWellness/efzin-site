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

/** Refunds a scheduled-payment invoice in full (adopting an earlier refund) and stores the refund id. */
export async function refundInactiveInvoiceNow(db: SqlClient, stripe: StripeApi, row: InactiveInvoiceRefund): Promise<string> {
  const metadata = { kind: "inactive_invoice", booking_id: row.booking_id ?? "", invoice_id: row.invoice_id };
  const payments = await stripe.invoicePayments.list({ invoice: row.invoice_id, status: "paid", limit: 10 });
  const pi = refId(payments.data[0]?.payment.payment_intent ?? null);
  if (!pi) throw new Error(`No payment found for invoice ${row.invoice_id}`);
  const earlier = (await stripe.refunds.list({ payment_intent: pi, limit: 100 })).data.find(
    (r) => r.metadata?.kind === metadata.kind && r.metadata?.invoice_id === row.invoice_id && live(r),
  );
  const refund =
    earlier ??
    (await stripe.refunds.create(
      { payment_intent: pi, amount: row.amount_minor, metadata },
      { idempotencyKey: `efzin-inactive-invoice-refund-${row.invoice_id}` },
    ));
  await db.query("update invoice_refunds set refund_id = $2 where invoice_id = $1", [row.invoice_id, refund.id]);
  return refund.id;
}

/** Refunds a pay-rest excess (adopting an earlier refund) and stores the refund id. */
export async function refundPayRestExcessNow(db: SqlClient, stripe: StripeApi, row: PayRestExcessRefund): Promise<string> {
  const metadata = { kind: "pay_rest_excess", booking_id: row.booking_id ?? "", session_id: row.session_id };
  const earlier = (await stripe.refunds.list({ payment_intent: row.payment_intent, limit: 100 })).data.find(
    (r) => r.metadata?.kind === metadata.kind && r.metadata?.session_id === row.session_id && live(r),
  );
  const refund =
    earlier ??
    (await stripe.refunds.create(
      { payment_intent: row.payment_intent, amount: row.excess_minor, metadata },
      { idempotencyKey: `efzin-payrest-refund-${row.session_id}` },
    ));
  await db.query("update pay_rest_settlements set refund_id = $2 where session_id = $1", [row.session_id, refund.id]);
  return refund.id;
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

/** Rows still owed an automatic refund (the daily job retries these; /admin/payments lists them). */
export async function pendingAutoRefunds(
  db: SqlClient,
): Promise<{ invoices: InactiveInvoiceRefund[]; payRest: PayRestExcessRefund[] }> {
  const inv = await db.query<InactiveInvoiceRefund>(
    "select invoice_id, booking_id, amount_minor from invoice_refunds where refund_id is null order by created_at, invoice_id",
  );
  const rest = await db.query<PayRestExcessRefund>(
    `select session_id, booking_id, payment_intent, excess_minor from pay_rest_settlements
      where refund_id is null and excess_minor > 0 and payment_intent is not null
      order by created_at, session_id`,
  );
  return { invoices: inv.rows, payRest: rest.rows };
}
