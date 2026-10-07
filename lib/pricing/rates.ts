/** USD-based rates (units per 1 USD). Never throws; returns {} on any failure. */
export async function getUsdRates(): Promise<Record<string, number>> {
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