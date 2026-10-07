import { afterEach, describe, expect, it, vi } from "vitest";
import { spotsLeftLabel } from "../../lib/booking/spots";
import { getSpotsLeft } from "../../lib/booking/availability";
import { policyCopy } from "../../lib/policy/copy";
import { visitorCurrency } from "../../lib/pricing/visitor";
import { getUsdRates } from "../../lib/pricing/rates";

describe("spotsLeftLabel", () => {
  it("shows text only for 1..5", () => {
    expect(spotsLeftLabel(5)).toBe("Only 5 spots left");
    expect(spotsLeftLabel(1)).toBe("Only 1 spot left");
    expect(spotsLeftLabel(6)).toBeNull();
    expect(spotsLeftLabel(0)).toBeNull();
    expect(spotsLeftLabel(null)).toBeNull();
  });
});

describe("getSpotsLeft", () => {
  it("returns null without database config", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await getSpotsLeft("x")).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("policyCopy", () => {
  it("event wording", () => {
    const t = policyCopy("standard_event").join(" ");
    expect(t).toMatch(/more than 48 hours/i);
    expect(t).toMatch(/credit only/i);
    expect(t).toMatch(/2 hours/);
  });
  it("retreat wording", () => {
    const t = policyCopy("standard_retreat").join(" ");
    expect(t).toMatch(/60 days/);
    expect(t).toMatch(/50%/);
    expect(t).toMatch(/10 days/);
  });
});

describe("visitorCurrency", () => {
  it("maps x-vercel-ip-country", () => {
    expect(visitorCurrency(new Headers({ "x-vercel-ip-country": "GB" }))).toBe("GBP");
    expect(visitorCurrency(new Headers())).toBeNull();
    expect(visitorCurrency(new Headers({ "x-vercel-ip-country": "ZZ" }))).toBeNull();
  });
});

describe("EFZIN_FAKE_USD_RATES", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("overrides the live feed", async () => {
    vi.stubEnv("EFZIN_FAKE_USD_RATES", '{"GBP":0.79}');
    expect(await getUsdRates()).toEqual({ GBP: 0.79 });
  });
});