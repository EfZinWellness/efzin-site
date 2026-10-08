import { currencyExponent } from "./currency";

/** Fixed peg: AED per 1 USD. Overrides any AED value in the rates feed. */
const AED_PER_USD = 3.6725;

/**
 * Convert minor units between currencies via USD. `usdRates` maps currency to
 * units per 1 USD. Rounding is explicit so callers can avoid overspending
 * (floor when crediting value, ceil when charging).
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  usdRates: Record<string, number>,
  round: "floor" | "ceil" | "round",
): number {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amountMinor;
  const rate = (c: string): number => {
    const r = c === "AED" ? AED_PER_USD : usdRates[c];
    if (!r || !(r > 0)) throw new Error(`No exchange rate for ${c}`);
    return r;
  };
  const major = amountMinor / 10 ** currencyExponent(f);
  const target = (major / rate(f)) * rate(t) * 10 ** currencyExponent(t);
  // Trim float noise (e.g. 12525.000000001) before applying the rounding mode.
  const cleaned = Math.round(target * 1e6) / 1e6;
  return Math[round](cleaned);
}
