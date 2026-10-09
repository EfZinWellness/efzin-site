import type { SqlClient } from "../content/sync";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountScheduleItem {
  seq: number;
  /** YYYY-MM-DD */
  dueOn: string;
  amountMinor: number;
  currency: string;
  status: "scheduled" | "paid" | "failed" | "cancelled";
}

export interface AccountGuest {
  /** booking_guests id (the target of a transfer). */
  id: string;
  name: string;
  detailsComplete: boolean;
  isBooker: boolean;
}

export interface AccountBooking {
  id: string;
  title: string;
  slug: string;
  type: "event" | "retreat";
  startAt: string | null;
  timezone: string;
  venue: string | null;
  status: string;
  isBooker: boolean;
  paymentOption: string | null;
  baseCurrency: string | null;
  /** Only for the booker. */
  schedule: AccountScheduleItem[];
  /** Only for the booker (everyone on the booking, booker first). */
  guests: AccountGuest[];
  /** The signed-in person's own guest row. */
  myDetailsComplete: boolean;
}

interface Row {
  id: string;
  title: string;
  slug: string;
  type: "event" | "retreat";
  start_at: string | Date | null;
  timezone: string;
  venue: string | null;
  status: string;
  is_booker: boolean;
  payment_option: string | null;
  base_currency: string | null;
  my_details_complete: boolean;
}

const ACTIVE = new Set(["paid", "deposit_paid"]);
const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

/** Every booking the person booked or is a guest on. Scoped to `personId` in SQL. */
async function bookingRows(db: SqlClient, personId: string, bookingId: string | null): Promise<Row[]> {
  const r = await db.query<Row>(
    `select b.id, e.title, e.slug, e.type, e.start_at, e.timezone, e.venue, b.status,
            (b.booker_person_id = $1) as is_booker, b.payment_option, b.base_currency,
            coalesce(bool_and(g.details_complete) filter (where g.person_id = $1), false) as my_details_complete
       from bookings b
       join experiences e on e.id = b.experience_id
       left join booking_guests g on g.booking_id = b.id
      where (b.booker_person_id = $1 or exists (
               select 1 from booking_guests mg where mg.booking_id = b.id and mg.person_id = $1))
        and ($2::uuid is null or b.id = $2::uuid)
      group by b.id, e.id
      order by e.start_at nulls last, b.created_at`,
    [personId, bookingId],
  );
  return r.rows;
}

async function attach(db: SqlClient, rows: Row[]): Promise<AccountBooking[]> {
  const mine = rows.filter((r) => r.is_booker).map((r) => r.id);
  const schedule = new Map<string, AccountScheduleItem[]>();
  const guests = new Map<string, AccountGuest[]>();
  if (mine.length > 0) {
    const items = await db.query<{ booking_id: string; seq: number; due_on: string; amount_minor: number; currency: string; status: AccountScheduleItem["status"] }>(
      `select booking_id, seq, to_char(due_on, 'YYYY-MM-DD') as due_on, amount_minor, currency, status
         from payment_schedule_items where booking_id = any($1::uuid[]) order by booking_id, seq`,
      [mine],
    );
    for (const i of items.rows) {
      const list = schedule.get(i.booking_id) ?? [];
      list.push({ seq: i.seq, dueOn: i.due_on, amountMinor: i.amount_minor, currency: i.currency, status: i.status });
      schedule.set(i.booking_id, list);
    }
    const gs = await db.query<{ id: string; booking_id: string; name: string; details_complete: boolean; is_booker: boolean }>(
      `select g.id, g.booking_id, p.name, g.details_complete, g.is_booker
         from booking_guests g join people p on p.id = g.person_id
        where g.booking_id = any($1::uuid[]) order by g.booking_id, g.is_booker desc, p.name`,
      [mine],
    );
    for (const g of gs.rows) {
      const list = guests.get(g.booking_id) ?? [];
      list.push({ id: g.id, name: g.name, detailsComplete: g.details_complete, isBooker: g.is_booker });
      guests.set(g.booking_id, list);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    type: r.type,
    startAt: iso(r.start_at),
    timezone: r.timezone,
    venue: r.venue,
    status: r.status,
    isBooker: r.is_booker,
    paymentOption: r.payment_option,
    baseCurrency: r.base_currency,
    schedule: schedule.get(r.id) ?? [],
    guests: guests.get(r.id) ?? [],
    myDetailsComplete: r.my_details_complete,
  }));
}

/** Upcoming = active (paid / deposit_paid) and not yet started; everything else is past. */
export async function loadBookings(
  db: SqlClient,
  personId: string,
  now: Date,
): Promise<{ upcoming: AccountBooking[]; past: AccountBooking[] }> {
  const all = await attach(db, await bookingRows(db, personId, null));
  const isUpcoming = (b: AccountBooking) => ACTIVE.has(b.status) && (b.startAt === null || new Date(b.startAt) > now);
  return { upcoming: all.filter(isUpcoming), past: all.filter((b) => !isUpcoming(b)).reverse() };
}

/** One booking, only if the person booked it or is a guest on it. */
export async function loadBooking(db: SqlClient, personId: string, bookingId: string): Promise<AccountBooking | null> {
  if (!UUID_RE.test(bookingId)) return null;
  const [b] = await attach(db, await bookingRows(db, personId, bookingId));
  return b ?? null;
}

/** Friends on my bookings who have not completed their details yet. */
export function pendingGuests(bookings: AccountBooking[]): { bookingId: string; title: string; name: string }[] {
  return bookings.flatMap((b) =>
    b.guests.filter((g) => !g.isBooker && !g.detailsComplete).map((g) => ({ bookingId: b.id, title: b.title, name: g.name })),
  );
}

/** Sum of scheduled and failed items. */
export function unpaidMinor(schedule: AccountScheduleItem[]): number {
  return schedule.filter((i) => i.status === "scheduled" || i.status === "failed").reduce((s, i) => s + i.amountMinor, 0);
}
