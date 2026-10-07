import { headers } from "next/headers";
import { getUsdRates } from "./rates";
import { visitorCurrency } from "./visitor";

/** Request-scoped pricing inputs: the visitor's currency (from geo header) and USD rates. */
export async function getPricingContext(): Promise<{
  visitorCurrency: string | null;
  rates: Record<string, number>;
}> {
  const [h, rates] = await Promise.all([headers(), getUsdRates()]);
  return { visitorCurrency: visitorCurrency(h), rates };
}