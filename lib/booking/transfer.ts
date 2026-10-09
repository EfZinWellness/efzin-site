import { provisionPeople, type AuthAdmin } from "../auth/provision";
import type { SqlClient } from "../content/sync";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { upsertPersonByEmail } from "../people/upsert";
import { cancelOptions } from "../policy/options";
import type { PolicyTemplate } from "../policy/types";

/** not_found: no such place (for this booker). not_allowed: policy says no (too late, inactive). invalid: bad name/email. duplicate: already on the booking. */
export type TransferErrorCode = "not_found" | "not_allowed" | "invalid" | "duplicate";

export class TransferError extends Error {
  constructor(public readonly code: TransferErrorCode) {
    super(code);
    this.name = "TransferError";
  }
}

export interface TransferOptions {
  /** Self-service: only the booker may transfer a place on their booking. */
  byPersonId?: string;
  sendEmail?: SendEmailFn;
  auth?: AuthAdmin | null;
  origin?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether the policy allows a guest transfer at `now` (for showing the Transfer form). */
export function transferAllowed(type: string, template: string | null, startAt: string | null, now: Date): boolean {
  if (!startAt) return false;
  return cancelOptions({
    template: (template ?? (type === "retreat" ? "standard_retreat" : "standard_event")) as PolicyTemplate,
    startsAt: new Date(startAt),
    now,
    amountPaidBaseMinor: 0,
    totalPriceBaseMinor: 0,
    amountPaidAedMinor: 0,
    cancelledBy: "guest",
  }).some((o) => o.kind === "transfer");
}

type Row = {
  booking_id: string;
  old_person: string;
  old_name: string;
  old_email: string;
  booker_person_id: string;
  booker_name: string;
  status: string;
  title: string;
  start_at: string | Date | null;
  timezone: string;
  template: string | null;
  type: string;
};

/**
 * Gives one place on a booking to someone else, when the policy allows a transfer at `now`
 * (events up to 2 hours before, retreats until the start). The guest row keeps its ticket; the
 * person changes, details and check-in reset. The new guest gets "booked you a spot" with a
 * claim link; the previous guest is told.
 */
export async function transferSpot(
  db: SqlClient,
  bookingGuestId: string,
  newGuest: { name: string; email: string },
  now: Date,
  opts: TransferOptions = {},
): Promise<{ personId: string }> {
  const name = newGuest.name.trim();
  const email = newGuest.email.trim().toLowerCase();
  if (!UUID_RE.test(bookingGuestId)) throw new TransferError("not_found");
  if (!name || name.length > 120 || !EMAIL_RE.test(email) || email.length > 254) throw new TransferError("invalid");

  let row: Row;
  let personId: string;
  await db.query("begin");
  try {
    const r = await db.query<Row>(
      `select g.booking_id, g.person_id as old_person, op.name as old_name, op.email as old_email,
              b.booker_person_id, bp.name as booker_name, b.status, e.title, e.start_at, e.timezone, e.type,
              coalesce(b.policy_snapshot->>'template', e.policy_template) as template
         from booking_guests g
         join bookings b on b.id = g.booking_id
         join experiences e on e.id = b.experience_id
         join people op on op.id = g.person_id
         join people bp on bp.id = b.booker_person_id
        where g.id = $1
        for update of g, b`,
      [bookingGuestId],
    );
    const found = r.rows[0];
    if (!found || (opts.byPersonId !== undefined && found.booker_person_id !== opts.byPersonId)) throw new TransferError("not_found");
    row = found;
    const allowed =
      (row.status === "paid" || row.status === "deposit_paid") &&
      transferAllowed(row.type, row.template, row.start_at ? new Date(row.start_at).toISOString() : null, now);
    if (!allowed) throw new TransferError("not_allowed");
    const dup = await db.query<{ n: number }>(
      `select count(*)::int as n from booking_guests g join people p on p.id = g.person_id
        where g.booking_id = $1 and lower(p.email) = $2`,
      [row.booking_id, email],
    );
    if (dup.rows[0].n > 0) throw new TransferError("duplicate");
    personId = await upsertPersonByEmail(db, { name, email });
    await db.query(
      "update booking_guests set person_id = $2, is_booker = false, details_complete = false, checked_in_at = null where id = $1",
      [bookingGuestId, personId],
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }

  if (opts.sendEmail) {
    const accountUrl = `${opts.origin ?? ""}/account`;
    const prov = await provisionPeople(db, opts.auth ?? null, [{ personId, email }], accountUrl);
    const common = { experience: row.title, startsAt: row.start_at ? new Date(row.start_at).toISOString() : null, timezone: row.timezone };
    await sendQuietly(opts.sendEmail, "guest_added", email, {
      ...common,
      name,
      bookerName: row.booker_name,
      claimLink: prov.links.get(personId) ?? accountUrl,
    });
    await sendQuietly(opts.sendEmail, "booking_transferred", row.old_email, { ...common, name: row.old_name, newGuestName: name });
  }
  return { personId };
}
