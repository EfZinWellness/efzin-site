import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { adminAddress } from "../requests/handlers";
import { refId, type StripeApi } from "./client";
import { sequence, type AfterCommit } from "./events";
import { voidOpenInvoices } from "./invoices";

interface Deps {
  db: SqlClient;
  stripe: StripeApi;
  sendEmail: SendEmailFn;
}

interface Settlement {
  booking_id: string | null;
  settled_minor: number;
  paid_minor: number | null;
  excess_minor: number;
  currency: string | null;
  invoice_ids: string[];
  booking_status: string | null;
  settled_item_ids: string[];
  refund_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** item_ids from the session metadata; null for an older session without it (settles every unpaid item). */
function itemIds(md: Stripe.Metadata): string[] | null {
  if (!md.item_ids) return null;
  return md.item_ids.split(",").filter((id) => UUID_RE.test(id));
}

/** Marks the session's items paid (those still unpaid) and records the outcome once per session. */
async function settle(s: Stripe.Checkout.Session, db: SqlClient): Promise<Settlement> {
  const prior = await db.query<Settlement>(
    `select booking_id, settled_minor, paid_minor, excess_minor, currency, invoice_ids, booking_status,
            settled_item_ids, refund_id
       from pay_rest_settlements where session_id = $1 for update`,
    [s.id],
  );
  if (prior.rows[0]) return prior.rows[0];

  const md = s.metadata ?? {};
  const bookingId = md.booking_id && UUID_RE.test(md.booking_id) ? md.booking_id : null;
  const b = await db.query<{ status: string; base_currency: string | null }>(
    "select status, base_currency from bookings where id = $1 for update",
    [bookingId],
  );
  const status = b.rows[0]?.status ?? null;
  const active = status === "deposit_paid" || status === "paid";

  let settled: { id: string; amount_minor: number; stripe_invoice_id: string | null }[] = [];
  if (active) {
    const r = await db.query<{ id: string; amount_minor: number; stripe_invoice_id: string | null }>(
      `update payment_schedule_items set status = 'paid', paid_at = now()
        where booking_id = $1 and status in ('scheduled', 'failed') and ($2::uuid[] is null or id = any($2::uuid[]))
        returning id, amount_minor, stripe_invoice_id`,
      [bookingId, itemIds(md)],
    );
    settled = r.rows;
    const sum = settled.reduce((t, i) => t + i.amount_minor, 0);
    await db.query(
      `update bookings set amount_paid_base_minor = coalesce(amount_paid_base_minor, 0) + $2,
              status = case when exists (
                select 1 from payment_schedule_items where booking_id = $1 and status in ('scheduled', 'failed'))
                then status else 'paid' end
        where id = $1`,
      [bookingId, sum],
    );
  }
  const settledMinor = settled.reduce((t, i) => t + i.amount_minor, 0);
  const currency = (s.currency ?? "").toUpperCase() || null;
  const base = b.rows[0]?.base_currency ?? null;
  const paid = s.amount_total ?? null;
  // Without a comparable amount (unknown or different currency) nothing is refunded automatically.
  const comparable = paid !== null && (!active || currency === null || base === null || currency === base);
  const excess = comparable ? Math.max(0, paid! - settledMinor) : 0;
  const row: Settlement = {
    booking_id: bookingId,
    settled_minor: settledMinor,
    paid_minor: paid,
    excess_minor: excess,
    currency,
    invoice_ids: settled.map((i) => i.stripe_invoice_id).filter((x): x is string => Boolean(x)),
    booking_status: status,
    settled_item_ids: settled.map((i) => i.id),
    refund_id: null,
  };
  await db.query(
    `insert into pay_rest_settlements
       (session_id, booking_id, settled_item_ids, settled_minor, paid_minor, excess_minor, currency, invoice_ids, booking_status,
        payment_intent)
     values ($1, $2, $3::uuid[], $4, $5, $6, $7, $8::text[], $9, $10)`,
    [s.id, bookingId, settled.map((i) => i.id), settledMinor, paid, excess, currency, row.invoice_ids, status, refId(s.payment_intent)],
  );
  return row;
}

/**
 * `checkout.session.completed` for "Pay the rest now". Settles only the items named in the
 * session that are still unpaid. Whatever the payment no longer covers (an instalment was
 * charged meanwhile, or the booking stopped being active) is refunded automatically, and
 * Tanya is told. Retries reuse the recorded settlement, and the refund id is stored once made,
 * so the refund happens at most once (also after Stripe's 24 h idempotency window).
 *
 * When the session was paid in another currency (Adaptive Pricing) the amounts cannot be
 * compared: nothing is refunded automatically, and Tanya is alerted whenever a listed item was
 * not settled or the settled sum differs from the session's expected amount.
 */
export async function completePayRest(s: Stripe.Checkout.Session, deps: Deps): Promise<AfterCommit> {
  const st = await settle(s, deps.db);
  const pi = refId(s.payment_intent);
  const md = s.metadata ?? {};
  const active = st.booking_status === "deposit_paid" || st.booking_status === "paid";
  const listed = itemIds(md);
  const expected = md.expected_amount_minor !== undefined ? Number(md.expected_amount_minor) : null;
  const settledIds = new Set(st.settled_item_ids);
  const unmatched =
    active &&
    st.excess_minor === 0 &&
    ((listed !== null && listed.some((id) => !settledIds.has(id))) || (expected !== null && expected !== st.settled_minor));
  const toRefund = st.excess_minor > 0 && pi !== null && st.refund_id === null;
  let refundFailed: string | null = null;
  const details = {
    bookingId: st.booking_id,
    bookingStatus: st.booking_status,
    session: s.id,
    paymentIntent: pi,
    paidMinor: st.paid_minor,
    settledMinor: st.settled_minor,
    currency: st.currency,
    expectedMinor: s.metadata?.expected_amount_minor ?? null,
  };
  return sequence(
    toRefund &&
      (async () => {
        try {
          const refund = await deps.stripe.refunds.create(
            { payment_intent: pi!, amount: st.excess_minor },
            { idempotencyKey: `efzin-payrest-refund-${s.id}` },
          );
          await deps.db.query("update pay_rest_settlements set refund_id = $2 where session_id = $1", [s.id, refund.id]);
        } catch (err) {
          // Don't fail the event: the invoices still get voided and Tanya refunds by hand.
          refundFailed = err instanceof Error ? err.message : String(err);
          console.error("[pay_rest] automatic refund failed", s.id, err);
        }
      }),
    () => voidOpenInvoices(deps.stripe, st.invoice_ids),
    () =>
      refundFailed !== null
        ? sendQuietly(deps.sendEmail, "admin_error", adminAddress(), {
            context: "pay_rest_refund_failed",
            problem: "A guest overpaid when paying the rest of a booking and the automatic refund failed. Please refund the excess by hand.",
            ...details,
            excessMinor: st.excess_minor,
            error: refundFailed,
          }).then(() => {})
        : Promise.resolve(),
    (toRefund || (st.excess_minor > 0 && pi === null) || (!active && st.excess_minor === 0) || unmatched) &&
      (async () => {
        if (refundFailed !== null) return;
        const refunded = st.excess_minor > 0 && pi !== null;
        await sendQuietly(deps.sendEmail, "admin_error", adminAddress(), {
          context: refunded ? "pay_rest_excess_refunded" : "pay_rest_needs_review",
          problem: refunded
            ? active
              ? "A guest paid the rest of a booking after part of it had already been paid. The difference was refunded automatically."
              : "A guest paid the rest of a booking that is no longer active. The payment was refunded automatically."
            : "A guest paid the rest of a booking but the amount could not be matched automatically. Please check and refund if needed.",
          ...details,
          refundedMinor: refunded ? st.excess_minor : 0,
        });
      }),
  );
}
