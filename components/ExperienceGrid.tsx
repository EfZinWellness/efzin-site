import type { Experience } from "@/lib/content/schema";
import { getSpotsLeft, minSpots } from "@/lib/booking/availability";
import { isDubai } from "@/lib/format";
import { ratesSubset } from "@/lib/pricing/visitor";
import ExperienceCard from "./ExperienceCard";
import ExperienceFilter from "./ExperienceFilter";

/** Server-rendered cards handed to the client-side filter. */
export default async function ExperienceGrid({
  experiences, visitorCurrency, rates,
}: {
  experiences: Experience[];
  visitorCurrency: string | null;
  rates: Record<string, number>;
}) {
  const items = await Promise.all(
    experiences.map(async (e, idx) => ({
      key: e.slug,
      dubai: isDubai(e),
      pillars: e.pillars,
      card: (
        <ExperienceCard
          experience={e}
          visitorCurrency={visitorCurrency}
          rates={ratesSubset(rates, [e.baseCurrency, visitorCurrency])}
          minSpots={minSpots(await getSpotsLeft(e.slug))}
          priority={idx === 0}
        />
      ),
    })),
  );
  return <ExperienceFilter items={items} />;
}