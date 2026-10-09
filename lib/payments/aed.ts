import { convertMinor } from "../pricing/convert";

/**
 * The AED value of a payment, for revenue (bookings.amount_aed_minor): exact for AED, otherwise
 * converted at today's rates (rounded). Null when no rate is available (Tanya is then told).
 */
export async function aedValueOf(
  amountMinor: number,
  currency: string,
  usdRates?: () => Promise<Record<string, number>>,
): Promise<number | null> {
  if (currency.toUpperCase() === "AED") return amountMinor;
  if (amountMinor === 0) return 0;
  if (!usdRates) return null;
  try {
    return convertMinor(amountMinor, currency, "AED", { ...(await usdRates()), USD: 1 }, "round");
  } catch {
    return null;
  }
}
