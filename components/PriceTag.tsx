import { estimateLocal, formatMoney } from "@/lib/pricing/estimate";

interface Props {
  baseMinor: number;
  baseCurrency: "AED" | "EUR";
  visitorCurrency: string | null;
  rates: Record<string, number>;
  className?: string;
}

/** `AED 250` plus, when we can estimate it, `≈ £54` in the visitor's currency. */
export default function PriceTag({ baseMinor, baseCurrency, visitorCurrency, rates, className }: Props) {
  const local =
    visitorCurrency ? estimateLocal(baseMinor, baseCurrency, visitorCurrency, rates) : null;
  return (
    <span className={className}>
      <span>{formatMoney(baseMinor, baseCurrency)}</span>
      {local !== null && visitorCurrency ? (
        <small className="ml-2 opacity-70">≈ {formatMoney(local, visitorCurrency)}</small>
      ) : null}
    </span>
  );
}