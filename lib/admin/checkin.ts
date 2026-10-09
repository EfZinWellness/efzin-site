import type { SqlClient } from "../content/sync";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CheckInResult = { ok: true; checkedIn: boolean } | { ok: false; error: string };

/**
 * Sets or clears checked_in_at in one statement (so two taps cannot race). Only guests on paid or
 * deposit_paid bookings can be checked in; the caller has already confirmed the user is an admin.
 */
export async function toggleCheckInDb(db: SqlClient, bookingGuestId: string, now: Date): Promise<CheckInResult> {
  if (typeof bookingGuestId !== "string" || !UUID.test(bookingGuestId)) return { ok: false, error: "Unknown guest." };
  const r = await db.query<{ checked_in_at: string | Date | null }>(
    `update booking_guests g
        set checked_in_at = case when g.checked_in_at is null then $2::timestamptz else null end
       from bookings b
      where g.id = $1 and b.id = g.booking_id and b.status in ('paid', 'deposit_paid')
      returning g.checked_in_at`,
    [bookingGuestId, now.toISOString()],
  );
  if (r.rows.length === 0) return { ok: false, error: "This guest cannot be checked in (booking not paid or not found)." };
  return { ok: true, checkedIn: r.rows[0].checked_in_at !== null };
}
