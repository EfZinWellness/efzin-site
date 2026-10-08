import type Stripe from "stripe";
import { sendQuietly } from "../email/send";
import { voidIfUnused } from "../giftcards/db";
import { adminAddress } from "../requests/handlers";
import { refId } from "./client";
import { sequence, type AfterCommit } from "./events";
import type { WebhookDeps } from "./handlers";
import { ACTIVE_BOOKING, bookingInvoices, voidOpenInvoices } from "./invoices";

/**
 * `charge.refunded` (refunds made in the Stripe dashboard). A booking's checkout payment fully
 * refunded → booking `refunded`, later payments stopped. A gift card purchase fully refunded →
 * cards voided if unused, otherwise Tanya decides. Partial refunds of bookings are recorded
 * by the cancellation flow that makes them, so they change nothing here.
 */
export async function onChargeRefunded(charge: Stripe.Charge, deps: WebhookDeps): Promise<AfterCommit | void> {
  const { db } = deps;
  const pi = refId(charge.payment_intent);
  if (!pi) return;
  const alert = (context: string, problem: string, extra: Record<string, unknown>) => async () => {
    await sendQuietly(deps.sendEmail, "admin_error", adminAddress(), { context, problem, paymentIntent: pi, ...extra });
  };

  const b = await db.query<{ id: string; status: string; gift_card_applied_aed_minor: number; credit_applied_aed_minor: number }>(
    `select id, status, gift_card_applied_aed_minor, credit_applied_aed_minor
       from bookings where stripe_payment_intent = $1 for update`,
    [pi],
  );
  const booking = b.rows[0];
  if (booking) {
    if (!charge.refunded) return;
    // Void first, whatever the status: a booking already refunded or cancelled (e.g. on a retry
    // after a failed void) must not keep open invoices that Stripe would go on charging.
    // voidOpenInvoices only voids invoices that are still open, so repeating it is safe.
    const invoices = await bookingInvoices(db, booking.id);
    const voidStep = () => voidOpenInvoices(deps.stripe, invoices);
    if (!ACTIVE_BOOKING.has(booking.status)) return voidStep;
    const later = await db.query<{ n: number }>(
      `select count(*)::int as n from payment_schedule_items
        where booking_id = $1 and seq > 0 and status = 'paid' and amount_minor > 0`,
      [booking.id],
    );
    await db.query("update bookings set status = 'refunded' where id = $1", [booking.id]);
    await db.query(
      "update payment_schedule_items set status = 'cancelled' where booking_id = $1 and status in ('scheduled', 'failed')",
      [booking.id],
    );
    const unsettled = later.rows[0].n > 0 || booking.gift_card_applied_aed_minor > 0 || booking.credit_applied_aed_minor > 0;
    // The alert (never throws) goes first: a retry after a failed void sees an inactive booking and only voids.
    return sequence(
      unsettled &&
        alert(
          "refund_needs_review",
          "A booking payment was fully refunded in Stripe and the booking is marked refunded, but other value was paid on it (later instalments, gift card or credit). Please settle the rest by hand.",
          { bookingId: booking.id, paidInstalments: later.rows[0].n },
        ),
      voidStep,
    );
  }

  const cards = await db.query<{ n: number }>("select count(*)::int as n from gift_cards where stripe_payment_intent = $1", [pi]);
  if (cards.rows[0].n === 0) return;
  if (!charge.refunded) {
    return alert("gift_refund_partial", "A gift card purchase was partly refunded in Stripe; the cards were left active.", {
      amountRefunded: charge.amount_refunded,
      amount: charge.amount,
    });
  }
  if ((await voidIfUnused(db, pi)) === "partly_used") {
    return alert(
      "gift_refund_partly_used",
      "A gift card purchase was refunded in Stripe but the card has been used, so it was not voided. Please decide what to do.",
      {},
    );
  }
}
