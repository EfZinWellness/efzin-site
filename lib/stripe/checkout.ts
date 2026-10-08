import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import type { Experience } from "../content/schema";
import { confirmPendingBooking } from "../booking/confirm";
import { attachCheckoutSession, createPendingBooking, releasePending } from "../booking/pending";
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
}

export type CheckoutResult = { kind: "redirect"; url: string } | { kind: "confirmed"; bookingId: string };

/**
 * Holds spots and gift value, then either confirms straight away (gift/credit cover
 * everything), opens Checkout in setup mode (first payment covered, later ones are not:
 * save the card), or opens Checkout in payment mode for the first payment.
 * Throws SoldOutError / CodeError from createPendingBooking.
 */
export async function startCheckout(req: BookingRequest, deps: CheckoutDeps): Promise<CheckoutResult> {
  const { db, stripe } = deps;
  const { id, payload } = await createPendingBooking(db, req, deps.experience, deps.now, deps.usdRates);
  const [first, ...later] = payload.allocation.schedule;
  const firstAmount = first.amountMinor;
  const laterAmount = later.reduce((s, i) => s + i.amountMinor, 0);

  try {
    if (firstAmount === 0 && laterAmount === 0) {
      return { kind: "confirmed", bookingId: await confirmPendingBooking(db, id, null) };
    }

    const savesCard = payload.option !== "full" || firstAmount === 0;
    const customer = savesCard ? await ensureStripeCustomer(db, stripe, payload.booker.personId) : undefined;
    const metadata = { kind: "booking", pending_booking_id: id };
    const currency = payload.baseCurrency.toLowerCase();
    const common = {
      client_reference_id: id,
      expires_at: Math.floor(Date.parse(payload.expiresAt) / 1000),
      metadata,
      success_url: `${deps.origin}/book/${payload.slug}/confirmed?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${deps.origin}/book/${payload.slug}`,
    };

    const params: Stripe.Checkout.SessionCreateParams =
      firstAmount === 0
        ? { ...common, mode: "setup", customer, currency, setup_intent_data: { metadata } }
        : {
            ...common,
            mode: "payment",
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
            ...(customer ? { customer } : { customer_email: payload.booker.email }),
            payment_intent_data: {
              metadata,
              ...(payload.option !== "full" ? { setup_future_usage: "off_session" as const } : {}),
            },
            after_expiration: { recovery: { enabled: true } },
          };

    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `efzin-checkout-${id}` });
    if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
    await attachCheckoutSession(db, id, session.id);
    return { kind: "redirect", url: session.url };
  } catch (err) {
    // Nothing was paid: give the spots and gift value back straight away.
    await releasePending(db, id).catch((e) => console.error("releasePending failed", e));
    throw err;
  }
}
