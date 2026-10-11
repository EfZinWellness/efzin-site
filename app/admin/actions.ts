"use server";

import { revalidatePath } from "next/cache";
import { adminPerson } from "@/lib/auth/admin";
import { toggleCheckInDb, type CheckInResult } from "@/lib/admin/checkin";
import { markRefundedByHand, parseMarkRefundedForm } from "@/lib/admin/payments";
import { resendChoiceEmail } from "@/lib/booking/efzinChoice";
import { getSqlClient, withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { requestOrigin } from "@/lib/requests/origin";

/**
 * Check-in toggle. Server actions are public endpoints, so the admin check is
 * repeated here: anybody else gets a refusal and nothing is read or written.
 */
export async function toggleCheckIn(bookingGuestId: string): Promise<CheckInResult> {
  if (!(await adminPerson())) return { ok: false, error: "Not available." };
  const db = await getSqlClient();
  if (!db) return { ok: false, error: "No database." };
  const r = await toggleCheckInDb(db, bookingGuestId, new Date());
  if (r.ok) revalidatePath("/admin/experiences/[slug]", "page");
  return r;
}

/**
 * /admin/payments "Mark refunded by hand": Tanya refunded it herself in Stripe, so the daily job
 * stops retrying it. Admin-only (checked here: server actions are public endpoints).
 */
export async function markRefundedByHandForm(form: FormData): Promise<void> {
  if (!(await adminPerson())) return;
  const parsed = parseMarkRefundedForm(form);
  if (!parsed) return;
  const db = await getSqlClient();
  if (!db) return;
  await markRefundedByHand(db, parsed.kind, parsed.ref, new Date());
  revalidatePath("/admin/payments");
}

/**
 * /admin/payments "Resend choice email": the booker's refund-or-credit email again (same token),
 * only while the choice is open. Admin-only.
 */
export async function resendChoiceEmailForm(form: FormData): Promise<void> {
  if (!(await adminPerson())) return;
  const bookingId = form.get("bookingId");
  if (typeof bookingId !== "string" || !bookingId) return;
  const origin = await requestOrigin();
  await withDbClient((db) => resendChoiceEmail(db, bookingId, { sendEmail, origin }));
  revalidatePath("/admin/payments");
}

/** Form wrapper used by the guest list buttons (works without client JavaScript). */
export async function toggleCheckInForm(form: FormData): Promise<void> {
  const id = form.get("bookingGuestId");
  await toggleCheckIn(typeof id === "string" ? id : "");
}
