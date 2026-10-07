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
    env: { EFZIN_FAKE_USD_RATES: JSON.stringify({ GBP: 0.79, EUR: 0.92 }), DATABASE_URL: "" },
  },
});
