"use client";

import { useState, type ReactNode } from "react";
import { PILLARS, type Pillar } from "@/lib/pillars";

export interface FilterItem {
  key: string;
  dubai: boolean;
  pillars: Pillar[];
  card: ReactNode;
}

type Place = "all" | "dubai" | "abroad";

const chip = (on: boolean) =>
  `border px-4 py-2 text-[10px] uppercase tracking-[0.2em] ${
    on ? "border-navy bg-navy text-ivory" : "border-sand text-navy"
  }`;

export default function ExperienceFilter({ items }: { items: FilterItem[] }) {
  const [place, setPlace] = useState<Place>("all");
  const [pillar, setPillar] = useState<Pillar | null>(null);

  const shown = items.filter(
    (i) =>
      (place === "all" || (place === "dubai") === i.dubai) &&
      (pillar === null || i.pillars.includes(pillar)),
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by place">
        {([["all", "All places"], ["dubai", "Dubai"], ["abroad", "Abroad"]] as const).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={place === v} onClick={() => setPlace(v)} className={chip(place === v)}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter by pillar">
        {(Object.keys(PILLARS) as Pillar[]).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pillar === p}
            onClick={() => setPillar(pillar === p ? null : p)}
            className={chip(pillar === p)}
          >
            {PILLARS[p].label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-12 text-center text-sm text-stone">Nothing matches just yet. Try another filter.</p>
      ) : (
        <ul className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <li key={i.key}>{i.card}</li>
          ))}
        </ul>
      )}
    </div>
  );
}