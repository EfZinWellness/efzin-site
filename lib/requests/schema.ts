import { z } from "zod";

export const INTERESTS = ["move", "nourish", "thrive"] as const;

const budget = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  basis: z.enum(["per_person", "total"]),
});

const base = {
  name: z.string().trim().min(1),
  email: z.email(),
  phone: z.string().trim().optional(),
  howHeard: z.string().trim().optional(),
  notes: z.string().trim().max(4000).optional(),
};

const bespoke = {
  ...base,
  whoFor: z.enum(["friends", "family", "team", "just_me"]),
  occasion: z.enum(["birthday", "bachelorette", "anniversary", "other"]).optional(),
  where: z.enum(["dubai_half_day", "dubai_full_day", "abroad_multi_day", "flexible"]),
  groupSize: z.number().int().positive().optional(),
  ageRange: z.string().trim().max(40).optional(),
  interests: z.array(z.enum(INTERESTS)).default([]),
  accommodation: z.enum(["villa", "boutique_hotel", "sorted"]).optional(),
  budget: budget.optional(),
  links: z.string().trim().max(2000).optional(),
};

export const RequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("private"), ...bespoke }),
  z.object({
    type: z.literal("corporate"),
    ...bespoke,
    company: z.string().trim().min(1),
    teamSize: z.number().int().positive(),
    goals: z.array(z.string().trim().min(1)).default([]),
    invoiceContact: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("coaching"),
    ...base,
    format: z.enum(["in_person", "online", "hybrid"]).optional(),
    goals: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal("retreat_interest"),
    ...base,
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    groupSize: z.number().int().positive().optional(),
  }),
]);

export type RequestInput = z.infer<typeof RequestSchema>;

export const NewsletterSchema = z.object({
  name: z.string().trim().optional(),
  email: z.email(),
});