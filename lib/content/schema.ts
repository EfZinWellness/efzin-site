import { z } from "zod";
import type { PolicyTemplate } from "../policy/types";

const POLICIES = ["standard_event", "standard_retreat"] as const satisfies readonly PolicyTemplate[];

const isoDateTime = z.iso.datetime({ offset: true });
const imagePath = z
  .string()
  .refine((s) => s.startsWith("/images/") || s.startsWith("https://"), {
    message: "must start with /images/ or https://",
  });

const TicketSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits, dashes"),
  name: z.string().min(1),
  description: z.string().optional(),
  priceMinor: z.number().int().min(0),
  capacity: z.number().int().min(0),
});

export const ExperienceSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    type: z.enum(["event", "retreat"]),
    title: z.string().min(1),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    timezone: z.string().min(1),
    venue: z.object({
      name: z.string().min(1),
      address: z.string().optional(),
      mapUrl: z.string().url().optional(),
    }),
    partner: z.string().optional(),
    pillars: z.array(z.enum(["move", "nourish", "thrive"])),
    status: z.enum(["draft", "on_sale", "interest", "sold_out", "past"]),
    baseCurrency: z.enum(["AED", "EUR"]),
    policy: z.enum(POLICIES),
    heroImage: imagePath,
    gallery: z.array(imagePath).default([]),
    summary: z.string().min(1),
    story: z.string().default(""),
    schedule: z.array(z.object({ time: z.string(), label: z.string() })).default([]),
    tickets: z.array(TicketSchema).default([]),
    depositPct: z.number().int().min(1).max(100).optional(),
    totalPriceMinor: z.number().int().min(0).optional(),
    whoItsFor: z.string().optional(),
    accommodation: z.string().optional(),
    included: z.array(z.string()).default([]),
    notIncluded: z.array(z.string()).default([]),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  })
  .superRefine((e, ctx) => {
    if (Date.parse(e.endsAt) < Date.parse(e.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must not be before startsAt" });
    }
    const keys = e.tickets.map((t) => t.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["tickets"], message: "duplicate ticket keys" });
    }
    if (e.type === "retreat" && e.status !== "interest") {
      if (e.depositPct === undefined) {
        ctx.addIssue({ code: "custom", path: ["depositPct"], message: "retreats require depositPct unless status is interest" });
      }
      if (e.totalPriceMinor === undefined) {
        ctx.addIssue({ code: "custom", path: ["totalPriceMinor"], message: "retreats require totalPriceMinor unless status is interest" });
      }
    }
    if ((e.status === "on_sale" || e.status === "sold_out") && e.tickets.length === 0) {
      ctx.addIssue({ code: "custom", path: ["tickets"], message: "on_sale experiences need at least one ticket" });
    }
  });

export type Experience = z.infer<typeof ExperienceSchema>;
