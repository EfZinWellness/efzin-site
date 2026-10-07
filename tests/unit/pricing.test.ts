import { afterEach, describe, expect, it, vi } from "vitest";
import { currencyForCountry } from "../../lib/pricing/currency";
import { getUsdRates } from "../../lib/pricing/rates";
import { estimateLocal, formatMoney } from "../../lib/pricing/estimate";

describe("estimateLocal", () => {
  it("converts AED to GBP rounded to whole units", () => {
    expect(estimateLocal(25000, "AED", "GBP", { GBP: 0.79 })).toBe(5400);
  });
  it("returns null when target equals base or rate is missing", () => {
    expect(estimateLocal(25000, "AED", "AED", {})).toBeNull();
    expect(estimateLocal(25000, "AED", "GBP", {})).toBeNull();
  });
  it("converts EUR to AED using the fixed peg", () => {
    expect(estimateLocal(120000, "EUR", "AED", { EUR: 0.92 })).toBe(479000);
  });
  it("ignores an AED rate in the feed", () => {
    expect(estimateLocal(25000, "AED", "GBP", { GBP: 0.79, AED: 99 })).toBe(5400);
  });
  it("formats zero-decimal currencies", () => {
    expect(estimateLocal(25000, "AED", "JPY", { JPY: 150 })).toBe(10211);
    expect(formatMoney(10211, "JPY")).toBe("¥10,211");
  });
});

describe("formatMoney", () => {
  it("formats AED", () => {
    const s = formatMoney(25000, "AED");
    expect(s).toContain("250");
    expect(s).toContain("AED");
  });
});

describe("currencyForCountry", () => {
  it("maps countries", () => {
    expect(currencyForCountry("GR")).toBe("EUR");
    expect(currencyForCountry("AE")).toBe("AED");
    expect(currencyForCountry("XX")).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
  });
  it("covers required countries", () => {
    for (const c of "AE SA KW QA BH OM GR GB IE FR DE IT ES NL CH US CA AU LB JO EG IN JP".split(" ")) {
      expect(currencyForCountry(c), c).not.toBeNull();
    }
  });
});

describe("getUsdRates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns rates on success", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "success", rates: { GBP: 0.79 } }),
    });
    vi.stubGlobal("fetch", f);
    expect(await getUsdRates()).toEqual({ GBP: 0.79 });
    expect(f.mock.calls[0][0]).toBe("https://open.er-api.com/v6/latest/USD");
  });
  it("returns {} on network error, non-OK, or bad JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getUsdRates()).toEqual({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await getUsdRates()).toEqual({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: "error" }) }));
    expect(await getUsdRates()).toEqual({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
    expect(await getUsdRates()).toEqual({});
  });
});