import { afterEach, describe, expect, it, vi } from "vitest";
import type { StripeApi } from "../../lib/stripe/client";
import { ensureStripeCustomer } from "../../lib/stripe/customers";

function fakes() {
  const create = vi.fn(async (_params: Record<string, unknown>) => ({ id: "cus_1" }));
  const stripe = { customers: { create } } as unknown as StripeApi;
  const db = {
    async query(sql: string) {
      if (sql.startsWith("select")) {
        return { rows: [{ name: "Layla", email: "l@example.com", phone: null, stripe_customer_id: null }] };
      }
      return { rows: [{ stripe_customer_id: "cus_1" }] };
    },
  };
  return { create, stripe, db: db as never };
}

afterEach(() => vi.unstubAllEnvs());

describe("ensureStripeCustomer test clock hook", () => {
  it("adds test_clock for a test key plus STRIPE_TEST_CLOCK_ID", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", " sk_test_abc ");
    vi.stubEnv("STRIPE_TEST_CLOCK_ID", "clock_1");
    const f = fakes();
    await ensureStripeCustomer(f.db, f.stripe, "p1");
    expect(f.create.mock.calls[0][0]).toMatchObject({ test_clock: "clock_1" });
  });

  it("never adds test_clock with a live key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv("STRIPE_TEST_CLOCK_ID", "clock_1");
    const f = fakes();
    await ensureStripeCustomer(f.db, f.stripe, "p1");
    expect(f.create.mock.calls[0][0]).not.toHaveProperty("test_clock");
  });

  it("adds nothing without an id", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    vi.stubEnv("STRIPE_TEST_CLOCK_ID", "");
    const f = fakes();
    await ensureStripeCustomer(f.db, f.stripe, "p1");
    expect(f.create.mock.calls[0][0]).not.toHaveProperty("test_clock");
  });
});
