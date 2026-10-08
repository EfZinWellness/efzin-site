import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { "x-vercel-ip-country": "GB" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Stubbed FX rates so price estimates are deterministic (see lib/pricing/rates.ts).
    // EFZIN_EXTRA_CONTENT_DIR adds test-only experiences reachable by slug (see lib/content/load.ts).
    // EFZIN_TEST_AUTH_EMAIL + the efzin_test_auth cookie sign a test in (dev only, see lib/auth/testSeam.ts).
    // EFZIN_FAKE_BOOKING_STATUS answers the confirmed page's polling without a database (dev only).
    env: {
      EFZIN_FAKE_USD_RATES: JSON.stringify({ GBP: 0.79, EUR: 0.92 }),
      DATABASE_URL: "",
      EFZIN_EXTRA_CONTENT_DIR: "tests/e2e/fixtures",
      EFZIN_TEST_AUTH_EMAIL: "e2e@example.com",
      EFZIN_FAKE_BOOKING_STATUS: JSON.stringify({
        cs_e2e_confirmed: {
          status: "confirmed",
          firstName: "Layla",
          title: "E2E Retreat",
          venue: "Greece",
          startAt: "2030-06-10T07:00:00.000Z",
          timezone: "Europe/Athens",
          healthDone: false,
          pendingGuests: ["Sara"],
        },
      }),
    },
  },
});
