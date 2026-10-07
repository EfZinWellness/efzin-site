const COUNTRY_CURRENCY: Record<string, string> = {
  AE: "AED", SA: "SAR", KW: "KWD", QA: "QAR", BH: "BHD", OM: "OMR",
  LB: "LBP", JO: "JOD", EG: "EGP", IN: "INR", JP: "JPY",
  GB: "GBP", CH: "CHF", US: "USD", CA: "CAD", AU: "AUD",
  // Eurozone
  GR: "EUR", IE: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", ES: "EUR", NL: "EUR",
  PT: "EUR", AT: "EUR", BE: "EUR", FI: "EUR", CY: "EUR", MT: "EUR", LU: "EUR",
};

/** ISO-3166 alpha-2 -> ISO-4217, or null when unknown. */
export function currencyForCountry(country: string | null): string | null {
  if (!country) return null;
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? null;
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP"]);
const THREE_DECIMAL = new Set(["KWD", "BHD", "OMR", "JOD"]);

/** ISO-4217 minor-unit exponent. Single source of truth for pricing code. */
export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}