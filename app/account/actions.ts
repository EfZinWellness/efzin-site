"use server";

import { redirect } from "next/navigation";
import { requestDeletion } from "@/lib/account/deletion";
import { resendGiftCard } from "@/lib/account/giftResend";
import { CONSENT_REQUIRED, saveHealth } from "@/lib/account/health";
import { saveProfile } from "@/lib/account/profile";
import { requirePerson } from "@/lib/auth/session";
import { getSqlClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { requestOrigin } from "@/lib/requests/origin";
import { getStripe } from "@/lib/stripe/client";
import { SelfServeError, startPayRest, startUpdateCard } from "@/lib/stripe/selfServe";

/** Every action re-reads the signed-in person; nothing is taken from the form except the target id. */

export type FormState = { kind: "idle" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

const UNAVAILABLE: FormState = { kind: "error", message: "This is not available right now. Please try again later." };
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export async function saveHealthAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requirePerson();
  const input = {
    conditions: str(form, "conditions"),
    injuries: str(form, "injuries"),
    pregnancy: form.get("pregnancy") === "on",
    allergies: str(form, "allergies"),
    dietary: str(form, "dietary"),
    consent: form.get("consent") === "on" ? (true as const) : false,
    waiver: form.get("waiver") === "on",
  };
  // Validate consent before touching the database.
  if (input.consent !== true) return { kind: "error", message: CONSENT_REQUIRED };
  const db = await getSqlClient();
  if (!db) return UNAVAILABLE;
  const r = await saveHealth(db, me.personId, input, new Date());
  if (!r.ok) return { kind: "error", message: r.error };
  return {
    kind: "ok",
    message: r.complete ? "Saved. You're all set for your bookings." : "Saved. Please also accept the waiver.",
  };
}

export async function requestDeletionAction(): Promise<FormState> {
  const me = await requirePerson();
  const db = await getSqlClient();
  if (!db) return UNAVAILABLE;
  await requestDeletion(db, sendEmail, me.personId);
  return { kind: "ok", message: "Thank you. We'll confirm by email within 30 days." };
}

export async function saveProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requirePerson();
  const db = await getSqlClient();
  if (!db) return UNAVAILABLE;
  const r = await saveProfile(db, me.personId, {
    name: str(form, "name"),
    phone: str(form, "phone"),
    marketingConsent: form.get("marketing") === "on",
  });
  return r.ok ? { kind: "ok", message: "Saved." } : { kind: "error", message: r.error };
}

export async function resendGiftAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requirePerson();
  const db = await getSqlClient();
  if (!db) return UNAVAILABLE;
  const out = await resendGiftCard(db, { sendEmail, origin: await requestOrigin() }, me.personId, str(form, "giftCardId"));
  if (out === "sent") return { kind: "ok", message: `Sent to ${me.email}.` };
  if (out === "throttled") return { kind: "error", message: "You've re-sent this a few times. Please try again in an hour." };
  return { kind: "error", message: "We couldn't find that gift card." };
}

const SELF_SERVE_MESSAGES: Record<string, string> = {
  not_found: "We couldn't find a payment plan for you on this booking.",
  not_payable: "This booking has no payment plan open.",
  nothing_due: "Nothing is left to pay on this booking.",
};

async function selfServe(start: (deps: Parameters<typeof startPayRest>[0], personId: string) => Promise<{ url: string }>): Promise<FormState> {
  const me = await requirePerson();
  const db = await getSqlClient();
  const stripe = getStripe();
  if (!db || !stripe) return UNAVAILABLE;
  let url: string;
  try {
    ({ url } = await start({ db, stripe, origin: await requestOrigin() }, me.personId));
  } catch (err) {
    if (err instanceof SelfServeError) return { kind: "error", message: SELF_SERVE_MESSAGES[err.code] };
    console.error("[account] self-serve checkout failed", err);
    return { kind: "error", message: "Something went wrong. Please try again." };
  }
  redirect(url);
}

/** "Pay the rest now": Stripe Checkout for every unpaid item (booker only). */
export async function payRestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const bookingId = str(form, "bookingId");
  return selfServe((deps, personId) => startPayRest(deps, bookingId, personId));
}

/** "Update card": Stripe Checkout in setup mode for the booker's own customer. */
export async function updateCardAction(_prev: FormState, form: FormData): Promise<FormState> {
  const bookingId = str(form, "bookingId");
  return selfServe((deps, personId) => startUpdateCard(deps, personId, bookingId || undefined));
}
