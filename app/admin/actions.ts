"use server";

import { revalidatePath } from "next/cache";
import { adminPerson } from "@/lib/auth/admin";
import { toggleCheckInDb, type CheckInResult } from "@/lib/admin/checkin";
import { getSqlClient } from "@/lib/db/client";

/**
 * The admin view's only mutation. Server actions are public endpoints, so the admin check is
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

/** Form wrapper used by the guest list buttons (works without client JavaScript). */
export async function toggleCheckInForm(form: FormData): Promise<void> {
  const id = form.get("bookingGuestId");
  await toggleCheckIn(typeof id === "string" ? id : "");
}
