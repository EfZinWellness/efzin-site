"use server";

import { redirect } from "next/navigation";
import { CancelError } from "@/lib/booking/cancel";
import { decideChoice } from "@/lib/booking/efzinChoice";
import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { getStripe } from "@/lib/stripe/client";

/**
 * Confirms the guest's refund-or-credit choice after an Ef Zin cancellation. No login: the
 * unguessable token is the only key (decideChoice checks it and applies the choice at most
 * once). Always redirects back to the page, which shows the outcome.
 */
export async function confirmCancellationChoice(form: FormData): Promise<void> {
  const token = typeof form.get("token") === "string" ? (form.get("token") as string) : "";
  const choice = form.get("choice");
  const page = `/account/cancellation/${encodeURIComponent(token)}`;
  if (choice !== "refund" && choice !== "credit") redirect(page);
  let error = false;
  try {
    const done = await withDbClient((db) => decideChoice(db, getStripe(), token, choice, "guest", new Date(), { sendEmail }));
    if (!done) error = true;
  } catch (err) {
    if (!(err instanceof CancelError && err.code === "not_found")) console.error("[cancellation choice] failed", err);
    error = true;
  }
  redirect(error ? `${page}?error=1` : `${page}?done=1`);
}
