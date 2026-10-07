import { currencyForCountry } from "./currency";

/** Visitor's currency from the Vercel geo header, or null when unknown. */
export function visitorCurrency(headers: Headers): string | null {
  return currencyForCountry(headers.get("x-vercel-ip-country"));
}

/** Only the rates a component needs, so we do not ship the whole feed to the client. */
export function ratesSubset(
  rates: Record<string, number>,
  currencies: Array<string | null | undefined>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of currencies) {
    if (c && rates[c] !== undefined) out[c] = rates[c];
  }
  return out;
}