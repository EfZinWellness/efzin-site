import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import { calendarDate, endOfDayEpoch } from "../payments/schedule";
import { refId, type StripeApi } from "./client";
import { ensureStripeCustomer } from "./customers";

/** Bookings in these states take payments; invoice events for any other booking change nothing. */
export const ACTIVE_BOOKING = new Set(["paid", "deposit_paid"]);

export type ChargeResult =
  | { status: "skipped" }
  /** charged / failed: card invoice paid or declined. invoiced: pay-by-link invoice sent (no saved card). */
  | { status: "charged" | "failed" | "invoiced"; invoiceId: string };

type Item = {
  booking_id: string;
  seq: number;
  status: string;
  amount_minor: number;
  currency: string;
  due_on: string;
  stripe_invoice_id: string | null;
  booking_status: string;
  booker_person_id: string;
  stripe_customer_id: string | null;
  title: string;
  timezone: string;
};

/**
 * Collects one scheduled item through a Stripe Invoice in the base currency.
 *
 * - Saved card (customer default payment method): `charge_automatically` with that card,
 *   paid straight away. A decline returns `failed`; the `invoice.payment_failed` webhook
 *   records it and emails the guest.
 * - No customer or no saved card: the customer is created if needed and a `send_invoice`
 *   invoice due at the end of the item's due date (experience timezone; or of today there, when
 *   collected late) is finalized and sent (`sendInvoice`), so Stripe emails the pay link. The
 *   item stays `scheduled` until `invoice.paid`. A finalized pay-by-link invoice found on a later
 *   run is sent again with the same idempotency key (a no-op within Stripe's 24-hour window).
 *
 * `now` is the caller's clock (the daily job's run time); nothing here reads the system clock, so
 * a retried create sends identical parameters under its idempotency key.
 *
 * The invoice is built as a draft (`auto_advance: false`, so Stripe never finalizes it
 * half-built), its id stored at once, then the line added and the invoice finalized (with
 * `auto_advance: true`, so Stripe's retries apply) and paid. A run that stopped part-way is
 * resumed from the stored invoice: a draft without its line gets it, a draft or unpaid card
 * invoice is finalized/paid. Skips items whose booking isn't `deposit_paid`, items not due for
 * collection, and invoices already paid, voided, or being retried / paid by link.
 */
export async function chargeScheduledItem(db: SqlClient, stripe: StripeApi, itemId: string, now: Date): Promise<ChargeResult> {
  const r = await db.query<Item>(
    `select i.booking_id, i.seq, i.status, i.amount_minor, i.currency, to_char(i.due_on, 'YYYY-MM-DD') as due_on,
            i.stripe_invoice_id, b.status as booking_status, b.booker_person_id, p.stripe_customer_id,
            e.title, e.timezone
       from payment_schedule_items i
       join bookings b on b.id = i.booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where i.id = $1`,
    [itemId],
  );
  const item = r.rows[0];
  if (!item || item.booking_status !== "deposit_paid" || !["scheduled", "failed"].includes(item.status) || item.amount_minor <= 0) {
    return { status: "skipped" };
  }
  const key = (step: string) => ({ idempotencyKey: `efzin-item-${itemId}-${step}` });

  let invoiceId = item.stripe_invoice_id;
  let collection: Stripe.Invoice.CollectionMethod;
  let needsLine: boolean;
  if (invoiceId) {
    const inv = await stripe.invoices.retrieve(invoiceId);
    collection = inv.collection_method;
    if (inv.status === "open") {
      // Finalized but never paid by us (e.g. stopped before pay). Failed items are Stripe's to retry;
      // pay-by-link invoices are the guest's to pay (make sure the link went out).
      if (collection === "send_invoice" && item.status === "scheduled") return send(stripe, invoiceId, key);
      if (collection !== "charge_automatically" || item.status !== "scheduled") return { status: "skipped" };
      return pay(stripe, invoiceId, key);
    }
    if (inv.status !== "draft") return { status: "skipped" };
    if (inv.total !== 0 && inv.total !== item.amount_minor) {
      throw new Error(`INVOICE_TOTAL_MISMATCH: draft ${invoiceId} totals ${inv.total}, item ${itemId} is ${item.amount_minor}`);
    }
    needsLine = inv.total === 0;
  } else {
    const customer = item.stripe_customer_id ?? (await ensureStripeCustomer(db, stripe, item.booker_person_id));
    const c = await stripe.customers.retrieve(customer);
    if (c.deleted) throw new Error(`STRIPE_CUSTOMER_DELETED for schedule item ${itemId}`);
    const pm = refId(c.invoice_settings?.default_payment_method);
    collection = pm ? "charge_automatically" : "send_invoice";
    // Stripe needs a future due date: the item's date, or today (experience timezone) when late.
    const today = calendarDate(now, item.timezone);
    const dueDate = endOfDayEpoch(item.due_on > today ? item.due_on : today, item.timezone);
    const created = await stripe.invoices.create(
      {
        customer,
        currency: item.currency.toLowerCase(),
        collection_method: collection,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: `${item.title}: payment ${item.seq}`,
        metadata: { kind: "scheduled_payment", item_id: itemId, booking_id: item.booking_id },
        ...(pm ? { default_payment_method: pm } : { due_date: dueDate }),
      },
      key("invoice"),
    );
    invoiceId = created.id;
    await db.query(
      `update payment_schedule_items
          set stripe_invoice_id = $2, first_attempted_at = coalesce(first_attempted_at, $3)
        where id = $1 and stripe_invoice_id is null`,
      [itemId, invoiceId, now.toISOString()],
    );
    needsLine = true;
  }

  if (needsLine) {
    const customer = item.stripe_customer_id ?? (await ensureStripeCustomer(db, stripe, item.booker_person_id));
    await stripe.invoiceItems.create(
      {
        customer,
        invoice: invoiceId,
        amount: item.amount_minor,
        currency: item.currency.toLowerCase(),
        description: `${item.title}: payment ${item.seq}`,
        metadata: { kind: "scheduled_payment", item_id: itemId, booking_id: item.booking_id },
      },
      key("line"),
    );
  }
  await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true }, key("finalize"));
  if (collection !== "charge_automatically") return send(stripe, invoiceId, key);
  return pay(stripe, invoiceId, key);
}

/** Emails a finalized pay-by-link invoice to the guest (Stripe's hosted pay page). */
async function send(
  stripe: StripeApi,
  invoiceId: string,
  key: (step: string) => Stripe.RequestOptions,
): Promise<ChargeResult> {
  await stripe.invoices.sendInvoice(invoiceId, {}, key("send"));
  return { status: "invoiced", invoiceId };
}

async function pay(
  stripe: StripeApi,
  invoiceId: string,
  key: (step: string) => Stripe.RequestOptions,
): Promise<ChargeResult> {
  try {
    const paid = await stripe.invoices.pay(invoiceId, {}, key("pay"));
    return { status: paid.status === "paid" ? "charged" : "failed", invoiceId };
  } catch (err) {
    if ((err as { type?: string } | null)?.type === "StripeCardError") return { status: "failed", invoiceId };
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

/** Voids those of the given invoices that are still open. Safe to repeat: others are left alone. */
export async function voidOpenInvoices(stripe: StripeApi, invoiceIds: (string | null)[]): Promise<void> {
  for (const id of invoiceIds) {
    if (!id) continue;
    const inv = await stripe.invoices.retrieve(id);
    if (inv.status === "open") await stripe.invoices.voidInvoice(id);
  }
}
