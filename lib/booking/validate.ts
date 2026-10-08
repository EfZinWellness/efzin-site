import { z } from "zod";
import type { Experience } from "../content/schema";
import { effectiveStatus } from "../content/load";
import { isGiftCode, normaliseCode } from "../giftcards/code";
import type { PaymentOption } from "../payments/schedule";
import { paymentOptionsFor } from "./quote";

export interface BookingRequest {
  slug: string;
  lines: { ticketKey: string; qty: number }[];
  booker: { name: string; email: string; phone: string; howHeard?: string };
  guests: { name: string; email: string; phone?: string; ticketKey: string }[];
  paymentOption: PaymentOption;
  giftCode?: string;
  creditCode?: string;
  policyAccepted: true;
  /** Required unless the option is 'full'. */
  scheduleConsent?: true;
  /** Honeypot: must be empty. */
  website?: string;
}

export const MAX_GUESTS = 20;
const CREDIT_RE = /^EFZ-[A-HJ-NP-Z2-9]{6}$/;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.string().trim().min(1).max(max);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const RequestSchema = z.object({
  slug: z.string().min(1).max(100),
  lines: z
    .array(z.object({ ticketKey: z.string().min(1).max(60), qty: z.number().int().min(0).max(MAX_GUESTS + 1) }))
    .max(20),
  booker: z.object({
    name: text(200),
    email,
    phone: z.string().trim().min(5).max(40),
    howHeard: optionalText(200),
  }),
  guests: z
    .array(
      z.object({
        name: text(200),
        email,
        phone: optionalText(40),
        ticketKey: z.string().min(1).max(60),
      }),
    )
    .max(MAX_GUESTS),
  paymentOption: z.enum(["full", "deposit_balance", "instalments"]),
  giftCode: optionalText(40),
  creditCode: optionalText(40),
  policyAccepted: z.literal(true, { error: "Please accept the cancellation policy" }),
  scheduleConsent: z.literal(true).optional(),
  website: z.string().max(500).optional(),
});

type Result = { ok: true; value: BookingRequest } | { ok: false; errors: string[] };

export function validateBooking(req: unknown, exp: Experience, now: Date): Result {
  if (typeof req === "object" && req !== null && String((req as { website?: unknown }).website ?? "").trim() !== "") {
    return { ok: false, errors: ["Request rejected"] };
  }
  const parsed = RequestSchema.safeParse(req);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`) };
  }
  const v = parsed.data;
  const errors: string[] = [];

  if (v.slug !== exp.slug) errors.push("This booking is for a different experience");
  if (effectiveStatus(exp, now) !== "on_sale" || Date.parse(exp.endsAt) <= now.getTime()) {
    errors.push("This experience is not available for booking");
  }

  const lines = v.lines.filter((l) => l.qty > 0);
  const keys = new Set(exp.tickets.map((t) => t.key));
  if (lines.length === 0) errors.push("Choose at least one ticket");
  if (new Set(lines.map((l) => l.ticketKey)).size !== lines.length) errors.push("Each ticket type may appear once");
  for (const l of [...lines, ...v.guests]) {
    if (!keys.has(l.ticketKey)) errors.push(`Unknown ticket "${l.ticketKey}"`);
  }

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  if (totalQty !== 1 + v.guests.length) {
    errors.push(`Please add details for every guest: ${totalQty} tickets need ${Math.max(0, totalQty - 1)} guest(s)`);
  } else {
    for (const l of lines) {
      const assigned = v.guests.filter((g) => g.ticketKey === l.ticketKey).length;
      if (assigned > l.qty) errors.push(`More guests than "${l.ticketKey}" tickets`);
    }
    if (v.guests.some((g) => !lines.some((l) => l.ticketKey === g.ticketKey))) {
      errors.push("Each guest's ticket must be one of the tickets chosen");
    }
  }

  const emails = [v.booker.email, ...v.guests.map((g) => g.email)];
  if (new Set(emails).size !== emails.length) {
    errors.push("Each guest needs their own email address; the same email appears twice");
  }

  if (!paymentOptionsFor(exp, now).includes(v.paymentOption)) {
    errors.push("That payment option is not available for this experience");
  }
  if (v.paymentOption !== "full" && v.scheduleConsent !== true) {
    errors.push("Please agree that Ef Zin will charge this card on these dates");
  }

  const giftCode = v.giftCode ? normaliseCode(v.giftCode) : undefined;
  const creditCode = v.creditCode ? normaliseCode(v.creditCode) : undefined;
  if (giftCode && !isGiftCode(giftCode)) errors.push("That gift card code is not recognised");
  if (creditCode && !CREDIT_RE.test(creditCode)) errors.push("That credit code is not recognised");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug: v.slug,
      lines,
      booker: v.booker,
      guests: v.guests,
      paymentOption: v.paymentOption,
      ...(giftCode ? { giftCode } : {}),
      ...(creditCode ? { creditCode } : {}),
      policyAccepted: true,
      ...(v.scheduleConsent ? { scheduleConsent: true as const } : {}),
    },
  };
}
