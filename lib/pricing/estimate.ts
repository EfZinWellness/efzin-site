import { currencyExponent } from "./currency";

/** Fixed peg: AED per 1 USD. Overrides any AED value in the rates feed. */
const AED_PER_USD = 3.6725;

export function estimateLocal(
  baseMinor: number,
  baseCurrency: "AED" | "EUR",
  target: string,
  usdRates: Record<string, number>,
): number | null {
  const to = target.toUpperCase();
  if (to === baseCurrency) return null;
  const rate = (c: string): number | undefined =>
    c === "AED" ? AED_PER_USD : usdRates[c];
  const baseRate = rate(baseCurrency);
  const targetRate = rate(to);
  if (!baseRate || !targetRate) return null;

  const baseMajor = baseMinor / 10 ** currencyExponent(baseCurrency);
  const targetMajor = (baseMajor / baseRate) * targetRate;
  return Math.round(targetMajor) * 10 ** currencyExponent(to);
}

export function formatMoney(minor: number, currency: string): string {
  const major = minor / 10 ** currencyExponent(currency);
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(major);
}