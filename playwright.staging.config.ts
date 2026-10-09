import { defineConfig, devices } from "@playwright/test";

// Staging end-to-end run (`npm run test:e2e:staging`): only the staging spec, against the deployed
// preview named by E2E_STAGING_URL. No local server is started. See docs/launch-runbook.md, section F.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "booking.spec.ts",
  use: { baseURL: process.env.E2E_STAGING_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
