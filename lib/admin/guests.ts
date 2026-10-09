import { WAIVER_VERSION } from "../account/health";
import type { SqlClient } from "../content/sync";

export interface GuestHealth {
  conditions: string;
  injuries: string;
  pregnancy: boolean;
  allergies: string;
  dietary: string;
}

export interface AdminGuest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  ticket: string;
  isBooker: boolean;
  bookerName: string;
  detailsComplete: boolean;
  waiver: boolean;
  /** null when the guest has not filled in a health profile yet. */
  health: GuestHealth | null;
  checkedIn: boolean;
}

export interface GuestList {
  experience: { id: string; slug: string; title: string; startAt: string | null; timezone: string };
  guests: AdminGuest[];
}

/** Anyone who matters on the door: guests on paid / deposit_paid bookings. Health data is for admins only. */
export async function loadGuestList(db: SqlClient, slug: string): Promise<GuestList | null> {
  const e = await db.query<{ id: string; slug: string; title: string; start_at: string | Date | null; timezone: string }>(
    "select id, slug, title, start_at, timezone from experiences where slug = $1",
    [slug],
  );
  const exp = e.rows[0];
  if (!exp) return null;
  const r = await db.query<{
    id: string; name: string; email: string; phone: string | null; ticket: string; is_booker: boolean;
    booker_name: string; details_complete: boolean; waiver: boolean; checked_in_at: string | Date | null;
    has_health: boolean; conditions: string | null; injuries: string | null; pregnancy: boolean | null;
    allergies: string | null; dietary: string | null;
  }>(
    `select g.id, p.name, p.email, p.phone, t.name as ticket, g.is_booker, bp.name as booker_name,
            g.details_complete, g.checked_in_at,
            exists (select 1 from waivers w where w.person_id = p.id and w.version = $2) as waiver,
            (h.person_id is not null) as has_health,
            h.conditions, h.injuries, h.pregnancy, h.allergies, h.dietary
       from booking_guests g
       join bookings b on b.id = g.booking_id
       join people p on p.id = g.person_id
       join people bp on bp.id = b.booker_person_id
       join ticket_types t on t.id = g.ticket_type_id
       left join health_profiles h on h.person_id = p.id
      where b.experience_id = $1 and b.status in ('paid', 'deposit_paid')
      order by p.name, g.id`,
    [exp.id, WAIVER_VERSION],
  );
  return {
    experience: {
      id: exp.id, slug: exp.slug, title: exp.title,
      startAt: exp.start_at === null ? null : new Date(exp.start_at).toISOString(), timezone: exp.timezone,
    },
    guests: r.rows.map((x) => ({
      id: x.id, name: x.name, email: x.email, phone: x.phone, ticket: x.ticket, isBooker: x.is_booker,
      bookerName: x.booker_name, detailsComplete: x.details_complete, waiver: x.waiver,
      health: x.has_health
        ? {
            conditions: x.conditions ?? "", injuries: x.injuries ?? "", pregnancy: Boolean(x.pregnancy),
            allergies: x.allergies ?? "", dietary: x.dietary ?? "",
          }
        : null,
      checkedIn: x.checked_in_at !== null,
    })),
  };
}

/** Short flags for the door list, e.g. ["Pregnant", "Allergies: nuts"]. Empty when there is nothing to flag. */
export function healthFlags(h: GuestHealth | null): string[] {
  if (!h) return [];
  const out: string[] = [];
  if (h.pregnancy) out.push("Pregnant");
  if (h.conditions.trim()) out.push(`Conditions: ${h.conditions.trim()}`);
  if (h.injuries.trim()) out.push(`Injuries: ${h.injuries.trim()}`);
  if (h.allergies.trim()) out.push(`Allergies: ${h.allergies.trim()}`);
  return out;
}
