import BalanceForm from "@/components/BalanceForm";
import GiftForm from "@/components/GiftForm";
import { loadExperiences, effectiveStatus } from "@/lib/content/load";
import { addMonthsYmd, dubaiToday } from "@/lib/giftcards/dates";
import { getPricingContext } from "@/lib/pricing/context";
import { ratesSubset } from "@/lib/pricing/visitor";

export const metadata = {
  title: "Gift cards | Ef Zin",
  description: "Give the gift of an Ef Zin experience. Valid for 12 months on any event or retreat.",
};

export default async function GiftPage({ searchParams }: PageProps<"/gift">) {
  const sp = await searchParams;
  const now = new Date();
  const [all, ctx] = await Promise.all([loadExperiences(), getPricingContext()]);
  const options = all
    .filter((e) => effectiveStatus(e, now) === "on_sale")
    .map((e) => ({ slug: e.slug, title: e.title }));
  const forSlug = typeof sp.for === "string" ? sp.for : null;
  const initialSlug = forSlug && options.some((o) => o.slug === forSlug) ? forSlug : null;
  const today = dubaiToday(now);
  const paid = sp.paid === "1";

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14">
      <header className="text-center">
        <p className="greek text-sm">εὖ ζῆν</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight">Give an Ef Zin gift card</h1>
        <p className="mt-4 text-sm leading-6 text-navy/80">
          A gift card for movement, nourishment and time away, valid for 12 months on any event or retreat.
        </p>
      </header>

      {paid ? (
        <div role="status" className="mt-8 border border-sand/70 p-5 text-center">
          <p className="font-serif text-xl">Thank you.</p>
          <p className="mt-2 text-sm text-navy/80">Your payment is being confirmed. The card is emailed on the delivery date you chose.</p>
        </div>
      ) : null}

      <div className="mt-8">
        <GiftForm
          experiences={options}
          initialSlug={initialSlug}
          today={today}
          latest={addMonthsYmd(today, 12)}
          visitorCurrency={ctx.visitorCurrency}
          rates={ratesSubset(ctx.rates, [ctx.visitorCurrency])}
        />
      </div>

      <section className="mt-16 border-t border-sand/70 pt-10">
        <h2 className="font-serif text-2xl">Check your balance</h2>
        <div className="mt-4">
          <BalanceForm />
        </div>
      </section>
    </div>
  );
}
