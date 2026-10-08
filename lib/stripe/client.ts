import Stripe from "stripe";

/**
 * The slice of the Stripe client this app uses. The real `Stripe` instance satisfies it;
 * tests pass a typed fake so the real API is never called.
 */
export interface StripeApi {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string; url: string | null }>;
      expire(
        id: string,
        params?: Stripe.Checkout.SessionExpireParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string }>;
    };
  };
  customers: {
    create(params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
  };
}

let client: Stripe | null = null;

/** Lazily constructed from STRIPE_SECRET_KEY; null when no key is configured. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}
