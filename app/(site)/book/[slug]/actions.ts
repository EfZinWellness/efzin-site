"use server";

import { releaseCancelledCheckout } from "@/lib/booking/cancelReturn";
import { withDbClient } from "@/lib/db/client";
import { getStripe } from "@/lib/stripe/client";

/** Called when the guest comes back from Stripe Checkout via cancel_url. Never throws. */
export async function releaseCancelled(pendingId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe || typeof pendingId !== "string") return;
  try {
    await withDbClient((db) => releaseCancelledCheckout(db, stripe, pendingId));
  } catch (err) {
    // The 31-minute hold expiry and the checkout.session.expired webhook clean up instead.
    console.error("could not release a cancelled checkout", err);
  }
}
