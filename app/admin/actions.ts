"use server";

import { revalidatePath } from "next/cache";
import { adminPerson } from "@/lib/auth/admin";
import { toggleCheckInDb, type CheckInResult } from "@/lib/admin/checkin";
import { markRefundedByHand } from "@/lib/admin/payments";
import { getSqlClient } from "@/lib/db/client";

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
  const kind = form.get("kind");
  const ref = form.get("ref");
  if ((kind !== "inactive_invoice" && kind !== "pay_rest_excess") || typeof ref !== "string" || !ref) return;
  const db = await getSqlClient();
  if (!db) return;
  await markRefundedByHand(db, kind, ref, new Date());
  revalidatePath("/admin/payments");
}

/** Form wrapper used by the guest list buttons (works without client JavaScript). */
export async function toggleCheckInForm(form: FormData): Promise<void> {
  const id = form.get("bookingGuestId");
  await toggleCheckIn(typeof id === "string" ? id : "");
}
