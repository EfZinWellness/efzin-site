import type { SqlClient } from "../content/sync";
import type { GuestHealth } from "./guests";
import { revenueBooking } from "./upcoming";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString());
const day = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString().slice(0, 10));

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Sum of amount_aed_minor of the person's own bookings in REVENUE_STATUSES (money kept on cancelled ones included). */
  totalSpentAedMinor: number;
  bookingCount: number;
}

const SPENT = `coalesce((select sum(b.amount_aed_minor) from bookings b where b.booker_person_id = p.id and ${revenueBooking("b")}), 0)::int`;
const COUNT = `(select count(*) from bookings b where b.booker_person_id = p.id and b.status in ('paid', 'deposit_paid'))::int`;

/** Case-insensitive search by name or email; `%` and `_` in the query are literal. Empty query lists everyone. */
export async function searchPeople(db: SqlClient, q: string, limit = 200): Promise<PersonRow[]> {
  const term = q.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
  const r = await db.query<{
    id: string; name: string; email: string; phone: string | null; spent: number; n: number;
  }>(
    `select p.id, p.name, p.email, p.phone, ${SPENT} as spent, ${COUNT} as n
       from people p
      where $1 = '' or p.name ilike '%' || $1 || '%' escape '\\' or p.email ilike '%' || $1 || '%' escape '\\'
      order by p.name, p.id
      limit $2`,
    [term, limit],
  );
  return r.rows.map((x) => ({
    id: x.id, name: x.name, email: x.email, phone: x.phone, totalSpentAedMinor: x.spent, bookingCount: x.n,
  }));
}

export interface PersonBooking {
  id: string;
  slug: string;
  title: string;
  status: string;
  amountAedMinor: number;
  createdAt: string;
  /** "booker" when they paid, "guest" when somebody booked them. */
  role: "booker" | "guest";
  checkedIn: boolean;
  imported: boolean;
}

export interface PersonDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  birthday: string | null;
  howHeard: string | null;
  notes: string | null;
  marketingConsent: boolean;
  importedFrom: string | null;
  createdAt: string;
  totalSpentAedMinor: number;
  ownBookingCount: number;
  health: GuestHealth | null;
  bookings: PersonBooking[];
}

export async function loadPersonDetail(db: SqlClient, id: string): Promise<PersonDetail | null> {
  if (!UUID.test(id)) return null;
  const p = await db.query<{
    id: string; name: string; email: string; phone: string | null; birthday: string | Date | null;
    how_heard: string | null; notes: string | null; marketing_consent: boolean; imported_from: string | null;
    created_at: string | Date; spent: number; own: number;
    has_health: boolean; conditions: string | null; injuries: string | null; pregnancy: boolean | null;
    allergies: string | null; dietary: string | null;
  }>(
    `select p.id, p.name, p.email, p.phone, p.birthday, p.how_heard, p.notes, p.marketing_consent,
            p.imported_from, p.created_at, ${SPENT} as spent, own_booking_count(p.id) as own,
            (h.person_id is not null) as has_health, h.conditions, h.injuries, h.pregnancy, h.allergies, h.dietary
       from people p left join health_profiles h on h.person_id = p.id
      where p.id = $1`,
    [id],
  );
  const x = p.rows[0];
  if (!x) return null;
  const b = await db.query<{
    id: string; slug: string; title: string; status: string; amount: number | null; created_at: string | Date;
    is_booker: boolean; checked_in_at: string | Date | null; imported: boolean;
  }>(
    `select b.id, e.slug, e.title, b.status, b.amount_aed_minor as amount, b.created_at, b.imported,
            (b.booker_person_id = $1) as is_booker,
            (select max(g.checked_in_at) from booking_guests g where g.booking_id = b.id and g.person_id = $1) as checked_in_at
       from bookings b join experiences e on e.id = b.experience_id
      where b.booker_person_id = $1
         or exists (select 1 from booking_guests g where g.booking_id = b.id and g.person_id = $1)
      order by b.created_at desc, b.id`,
    [id],
  );
  return {
    id: x.id, name: x.name, email: x.email, phone: x.phone, birthday: day(x.birthday), howHeard: x.how_heard,
    notes: x.notes, marketingConsent: x.marketing_consent, importedFrom: x.imported_from,
    createdAt: iso(x.created_at)!, totalSpentAedMinor: x.spent, ownBookingCount: x.own,
    health: x.has_health
      ? {
          conditions: x.conditions ?? "", injuries: x.injuries ?? "", pregnancy: Boolean(x.pregnancy),
          allergies: x.allergies ?? "", dietary: x.dietary ?? "",
        }
      : null,
    bookings: b.rows.map((r) => ({
      id: r.id, slug: r.slug, title: r.title, status: r.status, amountAedMinor: r.amount ?? 0,
      createdAt: iso(r.created_at)!, role: r.is_booker ? "booker" : "guest",
      checkedIn: r.checked_in_at !== null, imported: r.imported,
    })),
  };
}
