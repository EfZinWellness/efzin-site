import Link from "next/link";
import Logo from "@/components/Logo";
import PriceTag from "@/components/PriceTag";
import { loadUpcoming } from "@/lib/content/listing";
import { effectiveStatus } from "@/lib/content/load";
import { bookHref, detailHref, formatRange, formatWhen, headlinePrice, interestHref } from "@/lib/format";
import { getPricingContext } from "@/lib/pricing/context";
import { ratesSubset } from "@/lib/pricing/visitor";
import { INSTAGRAM_URL, TAGLINE, WHATSAPP_URL } from "@/lib/site";

export const metadata = { title: "Now | Ef Zin", description: TAGLINE };

/** Link-in-bio page: always shows what is currently on sale. */
export default async function NowPage() {
  const [upcomingList, ctx] = await Promise.all([loadUpcoming(), getPricingContext()]);
  const now = new Date();
  const list = upcomingList.filter((e) => effectiveStatus(e, now) === "on_sale");
  return (
    <div className="mx-auto max-w-md px-4 py-14 text-center">
      <Logo />
      <p className="greek mt-3 text-sm">εὖ ζῆν</p>
      <p className="eyebrow mt-2">{TAGLINE}</p>

      <ul className="mt-10 space-y-4 text-left">
        {list.map((e) => {
          const price = headlinePrice(e);
          const cta = e.status === "interest" ? "Register interest" : e.status === "sold_out" ? "Join waitlist" : "Book";
          return (
            <li key={e.slug} className="border border-sand/70 bg-white/50 p-4">
              <Link href={detailHref(e)} className="block">
                <span className="eyebrow block text-teal">{e.type === "retreat" ? formatRange(e) : formatWhen(e)}</span>
                <span className="mt-1 block font-serif text-lg leading-snug">{e.title}</span>
              </Link>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm">
                  {price !== null && e.status !== "interest" ? (
                    <PriceTag
                      baseMinor={price}
                      baseCurrency={e.baseCurrency}
                      visitorCurrency={ctx.visitorCurrency}
                      rates={ratesSubset(ctx.rates, [e.baseCurrency, ctx.visitorCurrency])}
                    />
                  ) : (
                    <span className="text-stone">Dates to be confirmed</span>
                  )}
                </span>
                <Link
                  href={e.status === "interest" ? interestHref(e.slug) : bookHref(e.slug)}
                  className="btn btn-solid"
                  aria-label={`${cta}: ${e.title}`}
                >
                  {cta}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 flex flex-col gap-3">
        <a href={WHATSAPP_URL} className="btn">Speak to Tanya</a>
        <a href={INSTAGRAM_URL} className="btn">Instagram</a>
        <Link href="/events" className="btn">All events</Link>
      </div>
    </div>
  );
}