import type { Experience } from "./content/schema";

/** e.g. "Sun 25 Oct, 10:00" in the experience's own timezone. */
export function formatWhen(e: Pick<Experience, "startsAt" | "timezone">): string {
  const d = new Date(e.startsAt);
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: e.timezone,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: e.timezone,
  }).format(d);
  return `${day}, ${time}`;
}

/** Retreats span days: "1 May to 5 May 2027". */
export function formatRange(e: Pick<Experience, "startsAt" | "endsAt" | "timezone">): string {
  const f = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: e.timezone,
    }).format(new Date(iso));
  return `${f(e.startsAt, false)} to ${f(e.endsAt, true)}`;
}

export function isDubai(e: Pick<Experience, "timezone">): boolean {
  return e.timezone === "Asia/Dubai";
}

/** Headline price in base minor units: retreat total, else cheapest ticket. */
export function headlinePrice(e: Experience): number | null {
  if (e.totalPriceMinor !== undefined) return e.totalPriceMinor;
  if (e.tickets.length === 0) return null;
  return Math.min(...e.tickets.map((t) => t.priceMinor));
}

export function bookHref(slug: string): string {
  return `/book/${slug}`;
}

export function interestHref(slug: string): string {
  return `/bespoke?type=retreat_interest&slug=${slug}`;
}

export function detailHref(e: Pick<Experience, "type" | "slug">): string {
  return `/${e.type === "retreat" ? "retreats" : "events"}/${e.slug}`;
}