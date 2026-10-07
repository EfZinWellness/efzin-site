import Link from "next/link";
import type { Experience } from "@/lib/content/schema";
import { bookHref, headlinePrice, interestHref } from "@/lib/format";
import { WHATSAPP_URL } from "@/lib/site";
import PriceTag from "./PriceTag";

interface Props {
  experience: Experience;
  /** effective status (past is never passed here) */
  status: Experience["status"];
  visitorCurrency: string | null;
  rates: Record<string, number>;
}

/** Mobile-only fixed bar at the bottom of an experience page. */
export default function StickyBookBar({ experience: e, status, visitorCurrency, rates }: Props) {
  const price = headlinePrice(e);
  let cta: { label: string; href: string };
  if (status === "interest") cta = { label: "Register interest", href: interestHref(e.slug) };
  else if (status === "sold_out") cta = { label: "Join waitlist", href: `${bookHref(e.slug)}?waitlist=1` };
  else cta = { label: "Book", href: bookHref(e.slug) };

  return (
    <div
      data-testid="sticky-book-bar"
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 bg-navy px-4 py-3 text-ivory md:hidden"
    >
      <div className="min-w-0 text-sm">
        {price !== null && status !== "interest" ? (
          <PriceTag
            baseMinor={price}
            baseCurrency={e.baseCurrency}
            visitorCurrency={visitorCurrency}
            rates={rates}
          />
        ) : (
          <a href={WHATSAPP_URL} className="text-xs underline underline-offset-4">
            Speak to Tanya
          </a>
        )}
      </div>
      <Link href={cta.href} className="btn shrink-0">
        {cta.label}
      </Link>
    </div>
  );
}