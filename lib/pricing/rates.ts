/** USD-based rates (units per 1 USD). Never throws; returns {} on any failure. */
/**
 * Test hook: set EFZIN_FAKE_USD_RATES to a JSON object (e.g. {"GBP":0.79,"EUR":0.92})
 * to skip the network and use these rates. Used by playwright.config.ts.
 */
export async function getUsdRates(): Promise<Record<string, number>> {
  const fake = process.env.EFZIN_FAKE_USD_RATES;
  if (fake) {
    try {
      return JSON.parse(fake) as Record<string, number>;
    } catch {
      return {};
    }
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return {};
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return {};
    const { result, rates } = data as { result?: unknown; rates?: unknown };
    if (result !== "success" || !rates || typeof rates !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rates as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}