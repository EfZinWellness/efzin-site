import Image from "next/image";
import Link from "next/link";
import type { Experience } from "@/lib/content/schema";
import { detailHref, formatRange, formatWhen, headlinePrice } from "@/lib/format";
import { PILLARS } from "@/lib/pillars";
import { spotsLeftLabel } from "@/lib/booking/spots";
import PriceTag from "./PriceTag";

interface Props {
  experience: Experience;
  visitorCurrency: string | null;
  rates: Record<string, number>;
  minSpots: number | null;
  priority?: boolean;
}

export default function ExperienceCard({ experience: e, visitorCurrency, rates, minSpots, priority }: Props) {
  const price = headlinePrice(e);
  const spots = spotsLeftLabel(minSpots);
  return (
    <Link href={detailHref(e)} data-testid="experience-card" className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-sand/40">
        <Image
          src={e.heroImage}
          alt=""
          fill
          priority={priority}
          sizes="(min-width: 768px) 33vw, 100vw"
          className="fade-in object-cover transition-transform duration-700 group-hover:scale-[1.02]"
        />
      </div>
      <p className="eyebrow mt-4 text-teal">
        {e.pillars.map((p) => PILLARS[p].label).join(" · ")}
      </p>
      <h3 className="mt-2 font-serif text-xl leading-snug">{e.title}</h3>
      <p className="mt-1 text-xs text-stone">
        {e.type === "retreat" ? formatRange(e) : formatWhen(e)} · {e.venue.name}
      </p>
      <p className="mt-2 text-sm">
        {price !== null ? (
          <PriceTag
            baseMinor={price}
            baseCurrency={e.baseCurrency}
            visitorCurrency={visitorCurrency}
            rates={rates}
          />
        ) : (
          <span className="text-stone">Dates and price to be announced</span>
        )}
      </p>
      {spots ? <p className="mt-1 text-xs text-teal">{spots}</p> : null}
    </Link>
  );
}