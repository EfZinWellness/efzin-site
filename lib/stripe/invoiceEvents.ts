import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import { sendQuietly } from "../email/send";
import { balanceDueDate } from "../payments/schedule";
import { adminAddress } from "../requests/handlers";
import { refId } from "./client";
import type { AfterCommit } from "./events";
import type { WebhookDeps } from "./handlers";
import { ACTIVE_BOOKING } from "./invoices";

type ItemRow = {
  id: string;
  booking_id: string;
  status: string;
  stripe_invoice_id: string | null;
  /** Settled by a "Pay the rest now" Checkout. */
  pay_rest: boolean;
  amount_minor: number;
  currency: string;
  booking_status: string;
  booker_name: string;
  booker_email: string;
  title: string;
  start_at: string | Date | null;
  balance_due_days: number;
  timezone: string;
};

type Locked = { item: ItemRow; active: boolean; settled?: boolean } | null;

/**
 * The scheduled item an invoice is for, locked with its booking; null if it isn't ours or is
 * already settled. With `includeSettled`, a paid item comes back as `{ settled: true }`.
 */
async function lockItem(db: SqlClient, invoice: Stripe.Invoice, includeSettled = false): Promise<Locked> {
  const md = invoice.metadata ?? {};
  if (md.kind !== "scheduled_payment" || !md.item_id) return null;
  const r = await db.query<ItemRow>(
    `select i.id, i.booking_id, i.status, i.stripe_invoice_id, i.amount_minor, i.currency, b.status as booking_status,
            p.name as booker_name, p.email as booker_email, e.title, e.start_at, e.balance_due_days, e.timezone,
            exists (select 1 from pay_rest_settlements s where i.id = any(s.settled_item_ids)) as pay_rest
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where i.id = $1
      for update of i, b`,
    [md.item_id],
  );
  const item = r.rows[0];
  if (!item) return null;
  if (!ACTIVE_BOOKING.has(item.booking_status)) return { item, active: false };
  if (item.status === "paid" && includeSettled) return { item, active: true, settled: true };
  if (item.status === "paid" || item.status === "cancelled") return null;
  return { item, active: true };
}

const alertTanya =
  (deps: WebhookDeps, context: string, problem: string, extra: Record<string, unknown>): AfterCommit =>
  async () => {
    await sendQuietly(deps.sendEmail, "admin_error", adminAddress(), { context, problem, ...extra });
  };

/**
 * `invoice.paid` for a scheduled payment: item paid, booking paid once nothing is left, receipt.
 * Nothing changes (Tanya is emailed) when the booking is inactive or the amount/currency paid
 * does not match the item.
 */
export async function onInvoicePaid(invoice: Stripe.Invoice, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const locked = await lockItem(db, invoice, true);
  if (!locked) return;
  const { item } = locked;
  const facts = { invoiceId: invoice.id, bookingId: item.booking_id, itemId: item.id };
  if (locked.settled) {
    // Already paid: a repeat of the same invoice is fine; another invoice (or "pay the rest") means paid twice.
    if (item.stripe_invoice_id === invoice.id && !item.pay_rest) return;
    return alertTanya(
      deps,
      "possible_double_payment",
      `Invoice ${invoice.id} was paid for a scheduled payment that was already paid${
        item.pay_rest ? " through \"Pay the rest now\"" : ` under invoice ${item.stripe_invoice_id ?? "(none)"}`
      }. The guest may have paid twice; please check and refund if needed.`,
      { ...facts, paidInvoiceId: item.stripe_invoice_id, amountPaid: invoice.amount_paid, currency: invoice.currency },
    );
  }
  if (!locked.active) return refundInactiveInvoice(invoice, item, deps);
  if (invoice.amount_paid !== item.amount_minor || invoice.currency?.toLowerCase() !== item.currency.toLowerCase()) {
    return alertTanya(
      deps,
      "invoice_amount_mismatch",
      `Invoice ${invoice.id} was paid with ${invoice.amount_paid} ${invoice.currency} but the scheduled payment is ${item.amount_minor} ${item.currency}. Nothing was recorded; please check it.`,
      facts,
    );
  }
  await db.query(
    "update payment_schedule_items set status = 'paid', paid_at = now(), stripe_invoice_id = $2 where id = $1",
    [item.id, invoice.id],
  );
  const left = await db.query<{ n: number }>(
    `select coalesce(sum(amount_minor), 0)::int as n from payment_schedule_items
      where booking_id = $1 and status in ('scheduled', 'failed')`,
    [item.booking_id],
  );
  const remaining = left.rows[0].n;
  await db.query(
    `update bookings set amount_paid_base_minor = coalesce(amount_paid_base_minor, 0) + $2,
            status = case when $3 then 'paid' else status end
      where id = $1`,
    [item.booking_id, item.amount_minor, remaining === 0],
  );
  return async () => {
    await sendQuietly(deps.sendEmail, "scheduled_payment_receipt", item.booker_email, {
      name: item.booker_name,
      experience: item.title,
      amountMinor: item.amount_minor,
      currency: item.currency,
      remainingMinor: remaining,
      bookingId: item.booking_id,
    });
  };
}

/**
 * A scheduled payment that arrived after the booking stopped being active (cancelled, refunded,
 * credited): nothing changes on the booking and the payment is refunded in full, once. The
 * invoice is recorded in invoice_refunds when first seen; the refund (idempotency key per
 * invoice, and an earlier refund with our metadata is adopted) runs after the commit, its id is
 * stored, and Tanya is told. A repeat of the event after the refund id is stored does nothing.
 */
async function refundInactiveInvoice(invoice: Stripe.Invoice, item: ItemRow, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const rec = await db.query<{ refund_id: string | null }>(
    `insert into invoice_refunds (invoice_id, booking_id, amount_minor, currency) values ($1, $2, $3, $4)
     on conflict (invoice_id) do update set invoice_id = excluded.invoice_id returning refund_id`,
    [invoice.id, item.booking_id, invoice.amount_paid, invoice.currency?.toUpperCase() ?? null],
  );
  if (rec.rows[0].refund_id) return;
  const facts = {
    invoiceId: invoice.id,
    bookingId: item.booking_id,
    itemId: item.id,
    bookingStatus: item.booking_status,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
  };
  return async () => {
    const metadata = { kind: "inactive_invoice", booking_id: item.booking_id, invoice_id: invoice.id };
    try {
      const payments = await deps.stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 });
      const pi = refId(payments.data[0]?.payment.payment_intent ?? null);
      if (!pi) throw new Error(`No payment found for invoice ${invoice.id}`);
      const earlier = (await deps.stripe.refunds.list({ payment_intent: pi, limit: 100 })).data.find(
        (r) => r.metadata?.kind === metadata.kind && r.metadata?.invoice_id === invoice.id && r.status !== "failed" && r.status !== "canceled",
      );
      const refund =
        earlier ??
        (await deps.stripe.refunds.create(
          { payment_intent: pi, amount: invoice.amount_paid, metadata },
          { idempotencyKey: `efzin-inactive-invoice-refund-${invoice.id}` },
        ));
      await db.query("update invoice_refunds set refund_id = $2 where invoice_id = $1", [invoice.id, refund.id]);
      await alertTanya(
        deps,
        "payment_on_inactive_booking_refunded",
        `A scheduled payment was taken on booking ${item.booking_id} after it was cancelled. It was refunded in full automatically.`,
        { ...facts, refundId: refund.id },
      )();
    } catch (err) {
      await alertTanya(
        deps,
        "payment_on_inactive_booking_refund_failed",
        `Payment received on cancelled booking ${item.booking_id}; the automatic refund failed, please refund it by hand.`,
        { ...facts, error: err instanceof Error ? err.message : String(err) },
      )();
    }
  };
}

/**
 * `invoice.overdue`: a pay-by-link invoice passed its due date unpaid. Nothing changes (the daily
 * job still cancels the booking if the balance is unpaid after the balance due date); Tanya is told.
 */
export async function onInvoiceOverdue(invoice: Stripe.Invoice, deps: WebhookDeps): Promise<AfterCommit | void> {
  if (invoice.collection_method !== "send_invoice") return;
  const locked = await lockItem(deps.db, invoice);
  if (!locked?.active) return;
  const { item } = locked;
  const balanceDueOn = item.start_at ? balanceDueDate(new Date(item.start_at), item.balance_due_days, item.timezone) : null;
  return alertTanya(
    deps,
    "invoice_overdue",
    `A pay-by-link invoice for ${item.title} is overdue. The guest has no saved card; if it is still unpaid after ${
      balanceDueOn ?? "the balance due date"
    }, the booking will be cancelled automatically.`,
    {
      invoiceId: invoice.id,
      bookingId: item.booking_id,
      itemId: item.id,
      booker: `${item.booker_name} <${item.booker_email}>`,
      amountMinor: item.amount_minor,
      currency: item.currency,
      payUrl: invoice.hosted_invoice_url ?? null,
      balanceDueOn,
    },
  );
}

/**
 * `invoice.payment_failed`: item failed (+1 attempt); the guest gets the pay link, Tanya is told.
 * For an inactive booking nothing changes and only Tanya is told.
 */
export async function onInvoiceFailed(invoice: Stripe.Invoice, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const locked = await lockItem(db, invoice);
  if (!locked) return;
  const { item } = locked;
  if (!locked.active) {
    return alertTanya(deps, "retry_on_inactive_booking", `Stripe still retrying invoice ${invoice.id} for an inactive booking`, {
      invoiceId: invoice.id,
      bookingId: item.booking_id,
      bookingStatus: item.booking_status,
    });
  }
  const r = await db.query<{ attempts: number }>(
    `update payment_schedule_items set status = 'failed', attempts = attempts + 1, stripe_invoice_id = $2
      where id = $1 returning attempts`,
    [item.id, invoice.id],
  );
  const balanceDueOn = item.start_at
    ? balanceDueDate(new Date(item.start_at), item.balance_due_days, item.timezone)
    : null;
  const payUrl = invoice.hosted_invoice_url ?? `${deps.origin}/account`;
  return async () => {
    await sendQuietly(deps.sendEmail, "scheduled_payment_failed", item.booker_email, {
      name: item.booker_name,
      experience: item.title,
      amountMinor: item.amount_minor,
      currency: item.currency,
      payUrl,
      updateCardUrl: `${deps.origin}/account`,
      balanceDueOn,
    });
    await sendQuietly(deps.sendEmail, "admin_payment_failed", adminAddress(), {
      experience: item.title,
      booker: `${item.booker_name} <${item.booker_email}>`,
      amountMinor: item.amount_minor,
      currency: item.currency,
      attempts: r.rows[0].attempts,
      payUrl,
      balanceDueOn,
      bookingId: item.booking_id,
    });
  };
}
