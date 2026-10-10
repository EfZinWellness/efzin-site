import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import type { Experience } from "../content/schema";
import type { ConfirmEffects } from "../booking/afterConfirm";
import { confirmPendingBooking } from "../booking/confirm";
import {
  HOLD_MINUTES,
  attachCheckoutSession,
  createPendingBooking,
  extendPendingExpiry,
  releasePending,
} from "../booking/pending";
import { OPTION_LABELS } from "../booking/quote";
import type { BookingRequest } from "../booking/validate";
import type { StripeApi } from "./client";
import { ensureStripeCustomer } from "./customers";

export interface CheckoutDeps {
  db: SqlClient;
  stripe: StripeApi;
  now: Date;
  usdRates: Record<string, number>;
  /** Site origin for return URLs, e.g. https://www.efzinwellness.com */
  origin: string;
  /** The (validated) experience being booked. */
  experience: Experience;
  /** Accounts and emails for a booking confirmed here (fully covered by gift/credit). */
  effects?: ConfirmEffects;
}

/**
 * Which of the customer's saved cards Checkout offers: those saved with the guest's "save my
 * card" tick ('always') and those saved for a payment plan ('limited').
 */
export const SAVED_CARD_FILTERS: Stripe.Checkout.SessionCreateParams.SavedPaymentMethodOptions.AllowRedisplayFilter[] = [
  "always",
  "limited",
];

export type CheckoutResult ={ kind: "redirect"; url: string } | { kind: "confirmed"; bookingId: string };

/**
 * True only when Stripe definitely did not create the session: a 4xx answer. Network errors,
 * timeouts, 5xx and 409 (idempotency conflict) are ambiguous: a session may exist.
 */
export function definitelyRejected(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 409;
}

/**
 * Holds spots, gift value and credit, then either confirms straight away (gift/credit cover
 * everything), opens Checkout in setup mode (first payment covered, later ones are not:
 * save the card), or opens Checkout in payment mode for the first payment.
 *
 * Expiry: holds/reservations/claims start at `now + 31 min`; just before the Stripe call they
 * are moved to (call time + 31 min) and the session's `expires_at` is that same instant
 * (rounded down to the second), so they never lapse before the session.
 *
 * On failure, held value is released only when no live session can exist: before the Stripe
 * call, after a definite 4xx, or after the created session was expired. Otherwise the
 * `checkout.session.expired` webhook / hold expiry cleans up.
 */
export async function startCheckout(req: BookingRequest, deps: CheckoutDeps): Promise<CheckoutResult> {
  const { db, stripe } = deps;
  const startedMs = Date.now();
  const { id, payload } = await createPendingBooking(db, req, deps.experience, deps.now, deps.usdRates);
  const [first, ...later] = payload.allocation.schedule;
  const firstAmount = first.amountMinor;
  const laterAmount = later.reduce((s, i) => s + i.amountMinor, 0);

  let params: Stripe.Checkout.SessionCreateParams;
  try {
    if (firstAmount === 0 && laterAmount === 0) {
      return { kind: "confirmed", bookingId: await confirmPendingBooking(db, id, null, deps.effects) };
    }
    // A plan (or setup mode) saves the card for later charges; pay in full offers the guest a
    // "save my card" choice. Either way the booker's Stripe customer is attached.
    const savesCard = payload.option !== "full" || firstAmount === 0;
    const customer = await ensureStripeCustomer(db, stripe, payload.booker.personId);
    const callAtMs = deps.now.getTime() + (Date.now() - startedMs);
    const expiresAt = new Date(callAtMs + HOLD_MINUTES * 60_000);
    await extendPendingExpiry(db, id, expiresAt);

    const metadata = { kind: "booking", pending_booking_id: id };
    const currency = payload.baseCurrency.toLowerCase();
    const common = {
      // Card only: no delayed methods that settle days later. Apple Pay / Google Pay are card
      // wallets (PaymentMethod.card.wallet), not separate types, so Checkout still shows them
      // first where the device supports them.
      // (API 2026-09-30 replaced payment_method_types with this filter.)
      allowed_payment_method_types: ["card" as const],
      client_reference_id: id,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      metadata,
      success_url: `${deps.origin}/book/${payload.slug}/confirmed?session={CHECKOUT_SESSION_ID}`,
      // The book page releases this pending booking on return, so the guest can retry at once.
      cancel_url: `${deps.origin}/book/${payload.slug}?cancelled=${id}`,
    };
    params =
      firstAmount === 0
        ? { ...common, mode: "setup", customer, currency, setup_intent_data: { metadata } }
        : {
            ...common,
            mode: "payment",
            adaptive_pricing: { enabled: true },
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency,
                  unit_amount: firstAmount,
                  product_data: { name: `${payload.title} — ${OPTION_LABELS[payload.option]}` },
                },
              },
            ],
            customer,
            // Plans save the card off-session automatically (Stripe does not allow the save
            // checkbox together with setup_future_usage); pay in full offers the checkbox.
            // Returning guests see their saved cards, including ones saved by a plan ('limited').
            saved_payment_method_options: savesCard
              ? { allow_redisplay_filters: SAVED_CARD_FILTERS }
              : { payment_method_save: "enabled", allow_redisplay_filters: SAVED_CARD_FILTERS },
            payment_intent_data: {
              metadata,
              ...(savesCard ? { setup_future_usage: "off_session" as const } : {}),
            },
          };
  } catch (err) {
    // No Stripe session exists yet: give everything back straight away.
    await releasePending(db, id).catch((e) => console.error("releasePending failed", e));
    throw err;
  }

  let session: { id: string; url: string | null };
  try {
    session = await stripe.checkout.sessions.create(params, { idempotencyKey: `efzin-checkout-${id}` });
  } catch (err) {
    if (definitelyRejected(err)) {
      await releasePending(db, id).catch((e) => console.error("releasePending failed", e));
    }
    throw err;
  }

  try {
    if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
    await attachCheckoutSession(db, id, session.id);
    return { kind: "redirect", url: session.url };
  } catch (err) {
    try {
      await stripe.checkout.sessions.expire(session.id);
      await releasePending(db, id);
    } catch (e) {
      // The session may still be payable: keep the holds; webhook/expiry will clean up.
      console.error("could not expire Checkout session; holds kept until expiry", e);
    }
    throw err;
  }
}
