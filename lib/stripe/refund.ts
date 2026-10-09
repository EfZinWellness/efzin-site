import type { SqlClient } from "../content/sync";
import { refId, type ChargeRef, type StripeApi } from "./client";
import { bookingInvoices, voidOrDeleteInvoices } from "./invoices";

/** One card refund of a cancellation: what goes back to that charge, after its own fee. */
export interface CardRefund {
  chargeId: string;
  amountMinor: number;
  /** The charge's currency (upper case). */
  currency: string;
  /** Stripe fee deducted, in the charge's currency (0 when fees are not deducted). */
  feeMinor: number;
}

/**
 * Every payment intent that paid towards a booking: the checkout payment, each paid instalment
 * invoice (through its invoice payments) and each "Pay the rest now" Checkout.
 */
async function bookingPaymentIntents(db: SqlClient, stripe: StripeApi, bookingId: string): Promise<string[]> {
  const r = await db.query<{ pi: string }>(
    `select stripe_payment_intent as pi from bookings where id = $1 and stripe_payment_intent is not null
     union select payment_intent from pay_rest_settlements where booking_id = $1 and payment_intent is not null`,
    [bookingId],
  );
  const pis = r.rows.map((x) => x.pi);
  const inv = await db.query<{ id: string }>(
    `select distinct stripe_invoice_id as id from payment_schedule_items
      where booking_id = $1 and status = 'paid' and stripe_invoice_id is not null`,
    [bookingId],
  );
  for (const { id } of inv.rows) {
    const payments = await stripe.invoicePayments.list({ invoice: id, status: "paid", limit: 10 });
    for (const p of payments.data) {
      const pi = refId(p.payment.payment_intent ?? null);
      if (pi) pis.push(pi);
    }
  }
  return [...new Set(pis)];
}

/** The booking's succeeded charges with their balance transactions, newest first. */
export async function bookingCharges(db: SqlClient, stripe: StripeApi, bookingId: string): Promise<ChargeRef[]> {
  const byId = new Map<string, ChargeRef>();
  for (const pi of await bookingPaymentIntents(db, stripe, bookingId)) {
    const list = await stripe.charges.list({ payment_intent: pi, expand: ["data.balance_transaction"], limit: 100 });
    for (const c of list.data) if (c.status === "succeeded") byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
}

/**
 * The charge's Stripe fee in the charge's currency. The fee is in the balance (settlement)
 * currency; when that differs, `amount × exchange_rate = balance amount`, so fee ÷ rate.
 */
export function feeInChargeCurrency(c: ChargeRef): number {
  const bt = c.balance_transaction;
  if (!bt || typeof bt === "string") throw new Error(`Balance transaction not available for charge ${c.id}`);
  if (bt.currency.toLowerCase() === c.currency.toLowerCase() || !bt.exchange_rate) return bt.fee;
  return Math.round(bt.fee / bt.exchange_rate);
}

/**
 * Card money back across the charges (newest first): each charge's refundable amount (what is
 * left after earlier refunds) × `share`, rounded, minus that charge's fee when `deductFees`,
 * floored at 0. Charges with nothing to give back are left out.
 */
export function cardRefunds(charges: ChargeRef[], share: number, deductFees: boolean): CardRefund[] {
  if (!(share > 0)) return [];
  const out: CardRefund[] = [];
  for (const c of charges) {
    const refundable = c.amount - c.amount_refunded;
    if (refundable <= 0) continue;
    const gross = Math.min(refundable, Math.round(refundable * Math.min(1, share)));
    const fee = deductFees ? Math.min(gross, feeInChargeCurrency(c)) : 0;
    if (gross - fee <= 0) continue;
    out.push({ chargeId: c.id, amountMinor: gross - fee, currency: c.currency.toUpperCase(), feeMinor: fee });
  }
  return out;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Makes the recorded card refunds that have no Stripe refund id yet. The idempotency key is per
 * (booking, charge) and the params come from the stored row, so a retry within Stripe's 24-hour
 * window returns the same refund; the stored id stops any later retry.
 */
export async function issuePendingRefunds(db: SqlClient, stripe: StripeApi, bookingId: string): Promise<string[]> {
  const problems: string[] = [];
  const rows = await db.query<{ id: string; charge_id: string; amount_minor: number }>(
    "select id, charge_id, amount_minor from booking_refunds where booking_id = $1 and refund_id is null order by position, id",
    [bookingId],
  );
  for (const row of rows.rows) {
    try {
      // A refund made earlier whose id was never stored (e.g. the write failed) is adopted, so a
      // retry after Stripe's 24-hour idempotency window cannot refund twice.
      const existing = await stripe.refunds.list({ charge: row.charge_id, limit: 100 });
      const earlier = existing.data.find(
        (r) =>
          r.metadata?.kind === "cancellation" &&
          r.metadata?.booking_id === bookingId &&
          r.status !== "failed" &&
          r.status !== "canceled",
      );
      const refund =
        earlier ??
        (await stripe.refunds.create(
          { charge: row.charge_id, amount: row.amount_minor, metadata: { kind: "cancellation", booking_id: bookingId } },
          { idempotencyKey: `efzin-cancel-${bookingId}-${row.charge_id}` },
        ));
      await db.query("update booking_refunds set refund_id = $2, refunded_at = now() where id = $1", [row.id, refund.id]);
    } catch (err) {
      problems.push(`refund of ${row.amount_minor} on ${row.charge_id} failed: ${errText(err)}`);
    }
  }
  return problems;
}

/**
 * Expires the booker's open "Pay the rest now" Checkouts for this booking, and their open
 * "Update card" Checkouts when no other part-paid booking still needs the card. Sessions are
 * found by listing the booker's Stripe customer's open sessions and matching our metadata
 * (both kinds are always created for that customer), so no session ids need storing.
 */
export async function expireOpenSessions(db: SqlClient, stripe: StripeApi, bookingId: string): Promise<void> {
  const r = await db.query<{ customer: string | null; booker: string; other_plans: boolean }>(
    `select p.stripe_customer_id as customer, b.booker_person_id as booker,
            exists (select 1 from bookings o where o.booker_person_id = b.booker_person_id and o.id <> b.id
                      and o.status = 'deposit_paid') as other_plans
       from bookings b join people p on p.id = b.booker_person_id where b.id = $1`,
    [bookingId],
  );
  const b = r.rows[0];
  if (!b?.customer) return;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.checkout.sessions.list({
      customer: b.customer,
      status: "open",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const s of page.data) {
      const md = s.metadata ?? {};
      const payRest = md.kind === "pay_rest" && md.booking_id === bookingId;
      const updateCard = md.kind === "update_card" && md.person_id === b.booker && !b.other_plans;
      if (payRest || updateCard) await stripe.checkout.sessions.expire(s.id);
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

/**
 * The Stripe side of a committed cancellation: card refunds, open invoices voided, open
 * pay-rest / update-card Checkouts expired. Each step runs even when an earlier one fails;
 * the problems are returned (for Tanya), and calling this again finishes what is left.
 */
export async function settleCancellation(db: SqlClient, stripe: StripeApi | null, bookingId: string): Promise<string[]> {
  if (!stripe) {
    const pending = await db.query<{ n: number }>(
      "select count(*)::int as n from booking_refunds where booking_id = $1 and refund_id is null",
      [bookingId],
    );
    const invoices = await bookingInvoices(db, bookingId);
    return pending.rows[0].n > 0 || invoices.length > 0 ? ["STRIPE_SECRET_KEY is not configured: refunds and voids not done"] : [];
  }
  const problems = await issuePendingRefunds(db, stripe, bookingId);
  try {
    await voidOrDeleteInvoices(stripe, await bookingInvoices(db, bookingId));
  } catch (err) {
    problems.push(`voiding open / deleting draft invoices failed: ${errText(err)}`);
  }
  try {
    await expireOpenSessions(db, stripe, bookingId);
  } catch (err) {
    problems.push(`expiring open Checkout sessions failed: ${errText(err)}`);
  }
  return problems;
}
