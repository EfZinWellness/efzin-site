import { isStripeTestKey } from "../../lib/stripe/testKey";

type Env = Record<string, string | undefined>;

/**
 * Why the staging end-to-end spec should be skipped, or null to run it. Throws (instead of
 * skipping) when it is pointed at a live Stripe key or at a local server, because that is a
 * mistake to fix, not a reason to skip quietly.
 */
export function stagingSkipReason(env: Env): string | null {
  const required = [
    "E2E_STAGING_URL",
    "STRIPE_SECRET_KEY",
    "EFZIN_E2E_ADMIN_EMAIL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missing = required.find((k) => !env[k]?.trim());
  if (missing) {
    return `Staging end-to-end test skipped: ${missing} is not set. It needs E2E_STAGING_URL, STRIPE_SECRET_KEY (sk_test_), EFZIN_E2E_ADMIN_EMAIL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the staging project).`;
  }
  if (!isStripeTestKey(env.STRIPE_SECRET_KEY)) {
    throw new Error("Refusing to run the staging test: this works with Stripe test mode only. STRIPE_SECRET_KEY must start with sk_test_.");
  }
  const url = new URL(env.E2E_STAGING_URL!.trim());
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error("E2E_STAGING_URL must be the staging (Vercel preview) address, not the local dev server.");
  }
  if (host === "efzinwellness.com" || host.endsWith(".efzinwellness.com")) {
    throw new Error("E2E_STAGING_URL must be the staging (Vercel preview) address, never the real efzinwellness.com site.");
  }
  if (!env.E2E_STAGING_SLUG?.trim()) {
    throw new Error("E2E_STAGING_SLUG is not set. Set it to the slug of an experience that is on sale on staging.");
  }
  return null;
}
