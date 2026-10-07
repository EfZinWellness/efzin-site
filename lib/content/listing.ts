import { loadExperiences, effectiveStatus, upcoming } from "./load";
import type { Experience } from "./schema";

/** Upcoming public experiences (on sale, sold out, or interest), soonest first. */
export async function loadUpcoming(now = new Date()): Promise<Experience[]> {
  return upcoming(await loadExperiences(), now);
}

export async function loadPast(now = new Date()): Promise<Experience[]> {
  return (await loadExperiences())
    .filter((e) => e.status !== "draft" && effectiveStatus(e, now) === "past")
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}