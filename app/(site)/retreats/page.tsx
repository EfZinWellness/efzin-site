import ExperienceCard from "@/components/ExperienceCard";
import { loadExperiences, effectiveStatus } from "@/lib/content/load";
import { getSpotsLeft, minSpots } from "@/lib/booking/availability";
import { getPricingContext } from "@/lib/pricing/context";
import { ratesSubset } from "@/lib/pricing/visitor";

export const metadata = { title: "Retreats | Ef Zin" };

export default async function RetreatsPage() {
  const now = new Date();
  const [all, ctx] = await Promise.all([loadExperiences(), getPricingContext()]);
  const retreats = all.filter((e) => e.type === "retreat" && e.status !== "draft" && effectiveStatus(e, now) !== "past");
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <p className="greek text-center text-sm">εὖ ζῆν</p>
      <h1 className="mt-2 text-center font-serif text-3xl">Retreats</h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-navy/80">
        Several days to slow down: movement, nourishing food and space to come home to yourself.
      </p>
      <ul className="mt-10 grid gap-10 sm:grid-cols-2">
        {await Promise.all(
          retreats.map(async (e, idx) => (
            <li key={e.slug}>
              <ExperienceCard
                experience={e}
                visitorCurrency={ctx.visitorCurrency}
                rates={ratesSubset(ctx.rates, [e.baseCurrency, ctx.visitorCurrency])}
                minSpots={minSpots(await getSpotsLeft(e.slug))}
                priority={idx === 0}
              />
            </li>
          )),
        )}
      </ul>
    </div>
  );
}