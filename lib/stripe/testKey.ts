/** True only for a Stripe TEST-mode secret key. */
export function isStripeTestKey(key: string | undefined | null): boolean {
  return typeof key === "string" && key.trim().startsWith("sk_test_");
}

/**
 * Returns the trimmed key when it is a test-mode secret key; throws otherwise. Used by the staging
 * end-to-end test and the test-clock script so neither can ever touch live money. The error never
 * echoes the key.
 */
export function assertStripeTestKey(key: string | undefined | null): string {
  if (!key || !key.trim()) {
    throw new Error("STRIPE_SECRET_KEY is not set. Set it to your Stripe TEST key (starts with sk_test_).");
  }
  if (!isStripeTestKey(key)) {
    throw new Error("Refusing to run: this works with Stripe test mode only. STRIPE_SECRET_KEY must start with sk_test_.");
  }
  return key.trim();
}
