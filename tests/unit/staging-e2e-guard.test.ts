import { describe, expect, it } from "vitest";
import { stagingSkipReason } from "../e2e/staging";

const ok = {
  E2E_STAGING_URL: "https://efzin-git-phase1.vercel.app",
  STRIPE_SECRET_KEY: "sk_test_abc",
  EFZIN_E2E_ADMIN_EMAIL: "tanya@example.com",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  E2E_STAGING_SLUG: "2026-10-25-flow-and-create",
};

describe("staging e2e gate", () => {
  it("runs when everything is set with a test key", () => {
    expect(stagingSkipReason(ok)).toBeNull();
  });
  it("skips naming the first missing variable", () => {
    expect(stagingSkipReason({ ...ok, E2E_STAGING_URL: "" })).toMatch(/E2E_STAGING_URL/);
    expect(stagingSkipReason({ ...ok, EFZIN_E2E_ADMIN_EMAIL: undefined })).toMatch(/EFZIN_E2E_ADMIN_EMAIL/);
  });
  it("refuses a live key rather than skipping quietly", () => {
    expect(() => stagingSkipReason({ ...ok, STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(/test mode only/i);
  });
  it("refuses the real site, with or without www", () => {
    expect(() => stagingSkipReason({ ...ok, E2E_STAGING_URL: "https://www.efzinwellness.com" })).toThrow(/staging/i);
    expect(() => stagingSkipReason({ ...ok, E2E_STAGING_URL: "https://efzinwellness.com/" })).toThrow(/staging/i);
  });
  it("fails clearly when E2E_STAGING_SLUG is missing", () => {
    expect(() => stagingSkipReason({ ...ok, E2E_STAGING_SLUG: "" })).toThrow(/E2E_STAGING_SLUG/);
  });
  it("refuses to target localhost", () => {
    expect(() => stagingSkipReason({ ...ok, E2E_STAGING_URL: "http://localhost:3000" })).toThrow(/staging/i);
  });
});
