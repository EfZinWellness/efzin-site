import { describe, it, expect } from "vitest";
import { ExperienceSchema, type Experience } from "../../lib/content/schema";
import { loadExperiences, loadExperience, upcoming, effectiveStatus } from "../../lib/content/load";

const base = {
  slug: "x",
  type: "event",
  title: "X",
  startsAt: "2026-11-01T10:00:00+04:00",
  endsAt: "2026-11-01T12:00:00+04:00",
  timezone: "Asia/Dubai",
  venue: { name: "V" },
  pillars: ["move"],
  status: "on_sale",
  baseCurrency: "AED",
  policy: "standard_event",
  heroImage: "/images/x.jpg",
  gallery: [],
  summary: "s",
  story: "story",
  schedule: [],
  tickets: [{ key: "ga", name: "GA", priceMinor: 1000, capacity: 5 }],
  faqs: [],
};

describe("ExperienceSchema", () => {
  it("accepts a valid event", () => {
    expect(ExperienceSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a retreat on_sale without depositPct", () => {
    const r = ExperienceSchema.safeParse({ ...base, type: "retreat", policy: "standard_retreat", totalPriceMinor: 100000 });
    expect(r.success).toBe(false);
  });

  it("accepts a retreat on_sale with depositPct and totalPriceMinor", () => {
    const r = ExperienceSchema.safeParse({
      ...base,
      type: "retreat",
      policy: "standard_retreat",
      depositPct: 30,
      totalPriceMinor: 100000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts an interest retreat with no tickets or deposit", () => {
    const r = ExperienceSchema.safeParse({
      ...base,
      type: "retreat",
      policy: "standard_retreat",
      status: "interest",
      tickets: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an on_sale experience with no tickets", () => {
    expect(ExperienceSchema.safeParse({ ...base, tickets: [] }).success).toBe(false);
  });

  it("rejects a negative price", () => {
    const r = ExperienceSchema.safeParse({
      ...base,
      tickets: [{ key: "ga", name: "GA", priceMinor: -1, capacity: 5 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects bad image paths", () => {
    expect(ExperienceSchema.safeParse({ ...base, heroImage: "x.jpg" }).success).toBe(false);
  });

  it("rejects endsAt before startsAt", () => {
    expect(ExperienceSchema.safeParse({ ...base, endsAt: "2026-11-01T09:00:00+04:00" }).success).toBe(false);
  });

  it("rejects duplicate ticket keys", () => {
    const t = { key: "ga", name: "GA", priceMinor: 1, capacity: 1 };
    expect(ExperienceSchema.safeParse({ ...base, tickets: [t, t] }).success).toBe(false);
  });
});

describe("seed content", () => {
  it("parses the three seed files", async () => {
    const all = await loadExperiences();
    const slugs = all.map((e) => e.slug).sort();
    expect(slugs).toEqual(
      ["2026-10-04-strong-body-calm-mind", "2026-10-25-flow-and-create", "reform-athletica-retreat"].sort(),
    );
    const retreat = all.find((e) => e.slug === "reform-athletica-retreat")!;
    expect(retreat.status).toBe("interest");
    expect(retreat.baseCurrency).toBe("EUR");
    expect(retreat.timezone).toBe("Europe/Athens");
  });

  it("loadExperience returns null for unknown slug", async () => {
    expect(await loadExperience("nope")).toBeNull();
    expect((await loadExperience("2026-10-25-flow-and-create"))?.title).toContain("Flow & Create");
  });
});

describe("upcoming / effectiveStatus", () => {
  const mk = (slug: string, status: Experience["status"], startsAt: string, endsAt: string) =>
    ({ ...base, slug, status, startsAt, endsAt, tickets: [] }) as unknown as Experience;
  const now = new Date("2026-11-10T00:00:00Z");

  it("excludes past, draft and ended; sorts by start", () => {
    const list = [
      mk("late", "on_sale", "2026-12-20T10:00:00+04:00", "2026-12-20T12:00:00+04:00"),
      mk("ended", "on_sale", "2026-11-01T10:00:00+04:00", "2026-11-01T12:00:00+04:00"),
      mk("draft", "draft", "2026-12-01T10:00:00+04:00", "2026-12-01T12:00:00+04:00"),
      mk("pastflag", "past", "2026-12-02T10:00:00+04:00", "2026-12-02T12:00:00+04:00"),
      mk("soon", "sold_out", "2026-12-05T10:00:00+04:00", "2026-12-05T12:00:00+04:00"),
      mk("int", "interest", "2027-05-01T10:00:00+03:00", "2027-05-05T12:00:00+03:00"),
    ];
    expect(upcoming(list, now).map((e) => e.slug)).toEqual(["soon", "late", "int"]);
  });

  it("effective status becomes past after endsAt", () => {
    expect(effectiveStatus(mk("a", "on_sale", "2026-11-01T10:00:00+04:00", "2026-11-01T12:00:00+04:00"), now)).toBe("past");
    expect(effectiveStatus(mk("b", "on_sale", "2026-12-01T10:00:00+04:00", "2026-12-01T12:00:00+04:00"), now)).toBe("on_sale");
  });
});
