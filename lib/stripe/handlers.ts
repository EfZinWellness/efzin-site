import type Stripe from "stripe";
import type { AuthAdmin } from "../auth/provision";
import { afterBookingConfirmed } from "../booking/afterConfirm";
import { confirmPendingInTx, type ConfirmedPayment } from "../booking/confirm";
import { releasePending, type PendingPayload } from "../booking/pending";
import type { SqlClient } from "../content/sync";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { activateGiftPurchase, onGiftCardsActivated } from "../giftcards/activated";
import { adminAddress } from "../requests/handlers";
import { refId, type StripeApi } from "./client";
import { processOnce, sequence, type AfterCommit } from "./events";
import { bookingInvoices, onInvoiceFailed, onInvoicePaid, voidOpenInvoices } from "./invoices";
import { onChargeRefunded } from "./refunds";

export interface WebhookDeps {
  /** One dedicated connection: handlers run in a transaction. */
  db: SqlClient;
  stripe: StripeApi;
  sendEmail: SendEmailFn;
  /** Null when Supabase admin credentials are not configured (accounts are then not provisioned). */
  auth: AuthAdmin | null;
  /** Site origin for links in emails. */
  origin: string;
  now?: Date;
}

/**
 * Applies one Stripe event, at most once (keyed on the event id; see processOnce).
 * Throws on failure so the route answers 500 and Stripe retries.
 */
export async function handleStripeEvent(evt: Stripe.Event, deps: WebhookDeps): Promise<"processed" | "duplicate"> {
  return processOnce(deps.db, evt.id, () => dispatch(evt, deps));
}

async function dispatch(evt: Stripe.Event, deps: WebhookDeps): Promise<AfterCommit | void> {
  switch (evt.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onSessionCompleted(evt.data.object, deps);
    case "checkout.session.expired":
      return onSessionExpired(evt.data.object, deps);
    case "invoice.paid":
      return onInvoicePaid(evt.data.object, deps);
    case "invoice.payment_failed":
      return onInvoiceFailed(evt.data.object, deps);
    case "charge.refunded":
      return onChargeRefunded(evt.data.object, deps);
    default:
      return;
  }
}

async function onSessionCompleted(s: Stripe.Checkout.Session, deps: WebhookDeps): Promise<AfterCommit | void> {
  // A delayed payment method: `checkout.session.async_payment_succeeded` follows when it clears.
  if (s.mode === "payment" && s.payment_status === "unpaid") return;
  const md = s.metadata ?? {};
  switch (md.kind) {
    case "booking":
      return completeBooking(s, md.pending_booking_id, deps);
    case "gift_purchase":
      return completeGiftPurchase(s, deps);
    case "pay_rest":
      return completePayRest(md.booking_id, deps);
    case "update_card":
      return completeUpdateCard(s, deps);
    default:
      return;
  }
}

async function completeBooking(s: Stripe.Checkout.Session, pendingId: string | undefined, deps: WebhookDeps) {
  if (!pendingId) throw new Error(`Checkout session ${s.id} has no pending_booking_id`);
  const payment: ConfirmedPayment | null =
    s.mode === "payment" && s.amount_total != null
      ? {
          amountPaidMinor: s.amount_total,
          presentmentCurrency: s.currency ?? "",
          ...(refId(s.payment_intent) ? { paymentIntentId: refId(s.payment_intent)! } : {}),
        }
      : null;
  const outcome = await confirmPendingInTx(deps.db, pendingId, payment);
  const customer = refId(s.customer);
  // Emails first (they never throw): if saving the card fails, the retry finds the booking
  // already confirmed and only redoes the card step.
  return sequence(
    outcome.created && (() => afterBookingConfirmed(deps.db, outcome, deps)),
    customer ? () => saveSessionCard(deps.stripe, s, customer).then(() => {}) : null,
  );
}

/** Makes the card from this session the customer's default, for scheduled payments. */
async function saveSessionCard(stripe: StripeApi, s: Stripe.Checkout.Session, customer: string): Promise<string | null> {
  const setupIntent = refId(s.setup_intent);
  const paymentIntent = refId(s.payment_intent);
  let pm: string | null = null;
  if (s.mode === "setup" && setupIntent) pm = refId((await stripe.setupIntents.retrieve(setupIntent)).payment_method);
  else if (paymentIntent) pm = refId((await stripe.paymentIntents.retrieve(paymentIntent)).payment_method);
  if (pm) await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  return pm;
}

async function completeGiftPurchase(s: Stripe.Checkout.Session, deps: WebhookDeps) {
  const pi = refId(s.payment_intent);
  if (!pi) throw new Error(`Gift purchase session ${s.id} has no payment intent`);
  const n = await activateGiftPurchase(
    deps.db,
    {
      sessionId: s.id,
      paymentIntent: pi,
      amountPaidMinor: s.amount_total ?? 0,
      presentmentCurrency: s.currency ?? "",
      metadata: s.metadata ?? {},
    },
    deps.now ?? new Date(),
  );
  const cardsKnown =
    n > 0 || (await deps.db.query("select 1 from gift_cards where stripe_payment_intent = $1", [pi])).rows.length > 0;
  return sequence(
    !cardsKnown &&
      (async () => {
        await sendQuietly(deps.sendEmail, "admin_error", adminAddress(), {
          context: "gift_purchase_unmatched",
          problem: "A gift card purchase was paid but no matching cards were found.",
          session: s.id,
          paymentIntent: pi,
        });
      }),
    () => onGiftCardsActivated(deps.db, pi),
  );
}

async function completePayRest(bookingId: string | undefined, deps: WebhookDeps) {
  const { db } = deps;
  const b = await db.query<{ status: string }>("select status from bookings where id = $1 for update", [bookingId ?? null]);
  const status = b.rows[0]?.status;
  if (status !== "deposit_paid" && status !== "paid") {
    return async () => {
      await sendQuietly(deps.sendEmail, "admin_error", adminAddress(), {
        context: "pay_rest_inactive_booking",
        problem: "A guest paid the rest of a booking that is not active. Please refund or reinstate it.",
        bookingId,
        status,
      });
    };
  }
  const rest = await db.query<{ amount_minor: number }>(
    `update payment_schedule_items set status = 'paid', paid_at = now()
      where booking_id = $1 and status in ('scheduled', 'failed') returning amount_minor`,
    [bookingId],
  );
  const sum = rest.rows.reduce((t, r) => t + r.amount_minor, 0);
  await db.query(
    "update bookings set status = 'paid', amount_paid_base_minor = coalesce(amount_paid_base_minor, 0) + $2 where id = $1",
    [bookingId, sum],
  );
  // All of the booking's invoices (only open ones are voided), so a retry after a failed void still finds them.
  const invoices = await bookingInvoices(db, bookingId!);
  return () => voidOpenInvoices(deps.stripe, invoices);
}

async function completeUpdateCard(s: Stripe.Checkout.Session, deps: WebhookDeps) {
  let customer = refId(s.customer);
  if (!customer && s.metadata?.person_id) {
    const p = await deps.db.query<{ stripe_customer_id: string | null }>(
      "select stripe_customer_id from people where id = $1",
      [s.metadata.person_id],
    );
    customer = p.rows[0]?.stripe_customer_id ?? null;
  }
  if (!customer) throw new Error(`update_card session ${s.id} has no customer`);
  const c = customer;
  return async () => {
    const pm = await saveSessionCard(deps.stripe, s, c);
    if (!pm) return;
    const open = await deps.stripe.invoices.list({ customer: c, status: "open" });
    for (const inv of open.data) await deps.stripe.invoices.update(inv.id, { default_payment_method: pm });
  };
}

async function onSessionExpired(s: Stripe.Checkout.Session, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const md = s.metadata ?? {};
  if (md.kind !== "booking" || !md.pending_booking_id) return;
  const r = await db.query<{ confirmed_booking_id: string | null; payload: PendingPayload | string }>(
    "select confirmed_booking_id, payload from pending_bookings where id = $1 for update",
    [md.pending_booking_id],
  );
  const row = r.rows[0];
  if (!row || row.confirmed_booking_id) return;
  await releasePending(db, md.pending_booking_id);
  const p = typeof row.payload === "string" ? (JSON.parse(row.payload) as PendingPayload) : row.payload;
  // Once per pending checkout, and not if the guest has booked this experience since.
  const mark = await db.query<{ id: string }>(
    `update pending_bookings set abandoned_notified_at = now()
      where id = $1 and abandoned_notified_at is null
        and not exists (
          select 1 from bookings b join people pe on pe.id = b.booker_person_id
           where lower(pe.email) = lower($2) and b.experience_id = $3 and b.status in ('paid', 'deposit_paid'))
      returning id`,
    [md.pending_booking_id, p.booker.email, p.experienceId],
  );
  if (!mark.rows[0]) return;
  return async () => {
    await sendQuietly(deps.sendEmail, "abandoned_checkout", p.booker.email, {
      name: p.booker.name,
      experience: p.title,
      link: `${deps.origin}/book/${p.slug}`,
    });
  };
}
