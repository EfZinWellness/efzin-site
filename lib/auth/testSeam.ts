/** Cookie that, together with EFZIN_TEST_AUTH_EMAIL, signs an e2e test in. */
export const TEST_AUTH_COOKIE = "efzin_test_auth";

/**
 * E2E-only sign-in seam. Returns the test member's email when NOT a production build, the
 * EFZIN_TEST_AUTH_EMAIL variable is set and the request carries the test cookie; otherwise null.
 * Production builds never honour it (NODE_ENV is "production" for `next build` / `next start`).
 */
export function testAuthEmail(env: NodeJS.ProcessEnv, hasCookie: boolean): string | null {
  if (env.NODE_ENV === "production") return null;
  const email = env.EFZIN_TEST_AUTH_EMAIL?.trim();
  if (!email || !hasCookie) return null;
  return email.toLowerCase();
}
