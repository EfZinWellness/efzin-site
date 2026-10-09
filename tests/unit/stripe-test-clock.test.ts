import { describe, expect, it } from "vitest";
import { assertStripeTestKey, isStripeTestKey } from "../../lib/stripe/testKey";
import { CARDS, parseArgs, planDates } from "../../scripts/stripe-test-clock";

describe("Stripe test key guard", () => {
  it("accepts only sk_test_ keys", () => {
    expect(isStripeTestKey("sk_test_abc")).toBe(true);
    expect(isStripeTestKey("sk_live_abc")).toBe(false);
    expect(isStripeTestKey("rk_live_abc")).toBe(false);
    expect(isStripeTestKey("")).toBe(false);
    expect(isStripeTestKey(undefined)).toBe(false);
  });

  it("returns the key when it is a test key", () => {
    expect(assertStripeTestKey(" sk_test_abc ")).toBe("sk_test_abc");
  });

  it("refuses a live key, naming the problem without echoing the key", () => {
    expect(() => assertStripeTestKey("sk_live_SECRETVALUE")).toThrow(/test mode only/i);
    try {
      assertStripeTestKey("sk_live_SECRETVALUE");
    } catch (e) {
      expect(String(e)).not.toContain("SECRETVALUE");
    }
  });

  it("refuses a missing key", () => {
    expect(() => assertStripeTestKey(undefined)).toThrow(/STRIPE_SECRET_KEY/);
  });
});

describe("stripe-test-clock arguments", () => {
  it("defaults to setup with the failing card", () => {
    const a = parseArgs([]);
    expect(a.command).toBe("setup");
    expect(a.card).toBe("fail");
  });

  it("parses setup options", () => {
    const a = parseArgs(["setup", "--card", "ok", "--name", "Plan Tester", "--start", "2026-11-01"]);
    expect(a).toMatchObject({ command: "setup", card: "ok", name: "Plan Tester", start: "2026-11-01" });
  });

  it("parses advance with a clock and a date", () => {
    const a = parseArgs(["advance", "--clock", "clock_123", "--to", "2026-12-01"]);
    expect(a).toMatchObject({ command: "advance", clock: "clock_123", to: "2026-12-01" });
  });

  it("requires --clock and a valid --to for advance", () => {
    expect(() => parseArgs(["advance", "--to", "2026-12-01"])).toThrow(/--clock/);
    expect(() => parseArgs(["advance", "--clock", "clock_1"])).toThrow(/--to/);
    expect(() => parseArgs(["advance", "--clock", "clock_1", "--to", "tomorrow"])).toThrow(/YYYY-MM-DD/);
  });

  it("rejects unknown commands, cards and flags", () => {
    expect(() => parseArgs(["explode"])).toThrow(/unknown command/i);
    expect(() => parseArgs(["setup", "--card", "amex"])).toThrow(/--card/);
    expect(() => parseArgs(["setup", "--wat", "1"])).toThrow(/unknown option/i);
  });

  it("exposes the two test cards", () => {
    expect(CARDS.fail.number).toBe("4000000000000341");
    expect(CARDS.ok.number).toBe("4242424242424242");
  });

  it("lists the instalment dates from a start date, monthly", () => {
    expect(planDates("2026-11-30", 4)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28"]);
  });
});
