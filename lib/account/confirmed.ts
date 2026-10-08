import type { SqlClient } from "../content/sync";
import { healthComplete } from "./health";

export type BookingStatus =
  | { status: "pending" }
  | {
      status: "confirmed";
      firstName: string;
      title: string;
      venue: string | null;
      startAt: string | null;
      timezone: string;
      /** The booker has given health consent and accepted the waiver. */
      healthDone: boolean;
      /** First names of friends on the booking who have not completed their details. */
      pendingGuests: string[];
    };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/**
 * What the confirmed page shows for a Checkout session: pending until the webhook has turned
 * the pending booking into a booking. Only first names leave the server.
 */
export async function bookingStatusBySession(db: SqlClient, sessionId: string): Promise<BookingStatus> {
  const r = await db.query<{
    booking_id: string;
    booker_person_id: string;
    booker_name: string;
    title: string;
    venue: string | null;
    start_at: string | Date | null;
    timezone: string;
  }>(
    `select b.id as booking_id, b.booker_person_id, p.name as booker_name, e.title, e.venue, e.start_at, e.timezone
       from pending_bookings pb
       join bookings b on b.id = pb.confirmed_booking_id
       join people p on p.id = b.booker_person_id
       join experiences e on e.id = b.experience_id
      where pb.checkout_session_id = $1`,
    [sessionId],
  );
  const b = r.rows[0];
  if (!b) return { status: "pending" };
  const guests = await db.query<{ name: string }>(
    `select p.name from booking_guests g join people p on p.id = g.person_id
      where g.booking_id = $1 and not g.is_booker and not g.details_complete order by p.name`,
    [b.booking_id],
  );
  return {
    status: "confirmed",
    firstName: firstName(b.booker_name),
    title: b.title,
    venue: b.venue,
    startAt: b.start_at === null ? null : new Date(b.start_at).toISOString(),
    timezone: b.timezone,
    healthDone: await healthComplete(db, b.booker_person_id),
    pendingGuests: guests.rows.map((g) => firstName(g.name)),
  };
}

/** Stripe Checkout session ids look like cs_test_a1B2... / cs_live_... */
export const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,250}$/;

/**
 * Dev/e2e only: canned answers from EFZIN_FAKE_BOOKING_STATUS (JSON map of session id to status),
 * so the confirmed page can be tested without a database. Never used in production builds.
 */
export function fakeBookingStatus(env: NodeJS.ProcessEnv, sessionId: string): BookingStatus | null {
  if (env.NODE_ENV === "production" || !env.EFZIN_FAKE_BOOKING_STATUS) return null;
  try {
    const map = JSON.parse(env.EFZIN_FAKE_BOOKING_STATUS) as Record<string, BookingStatus>;
    return map[sessionId] ?? { status: "pending" };
  } catch {
    return null;
  }
}
