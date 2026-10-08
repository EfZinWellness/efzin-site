import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import { sendQuietly } from "../email/send";
import { balanceDueDate } from "../payments/schedule";
import { adminAddress } from "../requests/handlers";
import { refId, type StripeApi } from "./client";
import type { AfterCommit } from "./events";
import type { WebhookDeps } from "./handlers";

/** Bookings in these states take payments; invoice events for any other booking change nothing. */
export const ACTIVE_BOOKING = new Set(["paid", "deposit_paid"]);

export type ChargeResult = { status: "skipped" } | { status: "charged" | "failed"; invoiceId: string };

/**
 * Charges one scheduled item to the booker's saved card: an Invoice in the base currency,
 * charged automatically with the customer's default payment method. Skips items whose
 * booking isn't `deposit_paid`, items not due for collection and items that already have an
 * invoice (Stripe retries that one). A declined card returns `failed`; the
 * `invoice.payment_failed` webhook records it and emails the guest.
 */
export async function chargeScheduledItem(db: SqlClient, stripe: StripeApi, itemId: string): Promise<ChargeResult> {
  const r = await db.query<{
    booking_id: string;
    seq: number;
    status: string;
    amount_minor: number;
    currency: string;
    stripe_invoice_id: string | null;
    booking_status: string;
    stripe_customer_id: string | null;
    title: string;
  }>(
    `select i.booking_id, i.seq, i.status, i.amount_minor, i.currency, i.stripe_invoice_id,
            b.status as booking_status, p.stripe_customer_id, e.title
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where i.id = $1`,
    [itemId],
  );
  const item = r.rows[0];
  if (
    !item ||
    item.booking_status !== "deposit_paid" ||
    !["scheduled", "failed"].includes(item.status) ||
    item.stripe_invoice_id ||
    item.amount_minor <= 0
  ) {
    return { status: "skipped" };
  }
  const customer = item.stripe_customer_id;
  if (!customer) throw new Error(`NO_STRIPE_CUSTOMER for schedule item ${itemId}`);

  const c = await stripe.customers.retrieve(customer);
  if (c.deleted) throw new Error(`STRIPE_CUSTOMER_DELETED for schedule item ${itemId}`);
  // No saved card: the invoice still goes out and fails, which sends the guest the update-card link.
  const pm = refId(c.invoice_settings?.default_payment_method);
  const currency = item.currency.toLowerCase();
  const metadata = { kind: "scheduled_payment", item_id: itemId, booking_id: item.booking_id };
  const description = `${item.title}: payment ${item.seq}`;

  const invoice = await stripe.invoices.create(
    {
      customer,
      currency,
      collection_method: "charge_automatically",
      auto_advance: true,
      pending_invoice_items_behavior: "exclude",
      description,
      metadata,
      ...(pm ? { default_payment_method: pm } : {}),
    },
    { idempotencyKey: `efzin-item-${itemId}-invoice` },
  );
  await db.query("update payment_schedule_items set stripe_invoice_id = $2 where id = $1 and stripe_invoice_id is null", [
    itemId,
    invoice.id,
  ]);
  await stripe.invoiceItems.create(
    { customer, invoice: invoice.id, amount: item.amount_minor, currency, description, metadata },
    { idempotencyKey: `efzin-item-${itemId}-line` },
  );
  await stripe.invoices.finalizeInvoice(invoice.id, {}, { idempotencyKey: `efzin-item-${itemId}-finalize` });
  try {
    const paid = await stripe.invoices.pay(invoice.id, {}, { idempotencyKey: `efzin-item-${itemId}-pay` });
    return { status: paid.status === "paid" ? "charged" : "failed", invoiceId: invoice.id };
  } catch (err) {
    if ((err as { type?: string } | null)?.type === "StripeCardError") return { status: "failed", invoiceId: invoice.id };
    throw err;
  }
}

/** Every Stripe invoice created for a booking's schedule items. */
export async function bookingInvoices(db: SqlClient, bookingId: string): Promise<string[]> {
  const r = await db.query<{ stripe_invoice_id: string }>(
    "select stripe_invoice_id from payment_schedule_items where booking_id = $1 and stripe_invoice_id is not null",
    [bookingId],
  );
  return r.rows.map((x) => x.stripe_invoice_id);
}

/** Voids those of the given invoices that are still open (failed and being retried by Stripe). */
export async function voidOpenInvoices(stripe: StripeApi, invoiceIds: (string | null)[]): Promise<void> {
  for (const id of invoiceIds) {
    if (!id) continue;
    const inv = await stripe.invoices.retrieve(id);
    if (inv.status === "open") await stripe.invoices.voidInvoice(id);
  }
}

type ItemRow = {
  id: string;
  booking_id: string;
  status: string;
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

/** The scheduled item an invoice pays, locked with its booking; null if it isn't ours or the booking is inactive. */
async function lockItem(db: SqlClient, invoice: Stripe.Invoice): Promise<ItemRow | null> {
  const md = invoice.metadata ?? {};
  if (md.kind !== "scheduled_payment" || !md.item_id) return null;
  const r = await db.query<ItemRow>(
    `select i.id, i.booking_id, i.status, i.amount_minor, i.currency, b.status as booking_status,
            p.name as booker_name, p.email as booker_email, e.title, e.start_at, e.balance_due_days, e.timezone
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where i.id = $1
      for update of i, b`,
    [md.item_id],
  );
  const row = r.rows[0];
  if (!row || !ACTIVE_BOOKING.has(row.booking_status) || row.status === "paid" || row.status === "cancelled") return null;
  return row;
}

/** `invoice.paid` for a scheduled payment: item paid, booking paid once nothing is left, receipt. */
export async function onInvoicePaid(invoice: Stripe.Invoice, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const item = await lockItem(db, invoice);
  if (!item) return;
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

/** `invoice.payment_failed`: item failed (+1 attempt); the guest gets the pay link, Tanya is told. */
export async function onInvoiceFailed(invoice: Stripe.Invoice, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const item = await lockItem(db, invoice);
  if (!item) return;
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
