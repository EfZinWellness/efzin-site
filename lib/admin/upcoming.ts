import type { SqlClient } from "../content/sync";

export interface UpcomingExperience {
  id: string;
  slug: string;
  title: string;
  type: "event" | "retreat";
  status: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  capacity: number;
  /** Guests on paid / deposit_paid bookings. */
  sold: number;
  /** Capacity minus sold minus spots in unreleased holds (what the public site offers). */
  remaining: number;
  /** Sum of amount_aed_minor of paid / deposit_paid bookings (gift and credit applied are already inside it). */
  revenueAedMinor: number;
  /** Paying guests who have not completed their details (health and waiver). */
  missingDetails: number;
}

const iso = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString());

/** Experiences that are not drafts and have not finished yet (or have no date yet), soonest first. */
export async function loadUpcoming(db: SqlClient, now: Date): Promise<UpcomingExperience[]> {
  const r = await db.query<{
    id: string; slug: string; title: string; type: "event" | "retreat"; status: string;
    start_at: string | Date | null; end_at: string | Date | null; timezone: string;
    capacity: number; sold: number; remaining: number; revenue: number; missing: number;
  }>(
    `select e.id, e.slug, e.title, e.type, e.status, e.start_at, e.end_at, e.timezone,
            coalesce((select sum(t.capacity) from ticket_types t where t.experience_id = e.id), 0)::int as capacity,
            coalesce((select count(*) from booking_guests g join bookings b on b.id = g.booking_id
                       where b.experience_id = e.id and b.status in ('paid', 'deposit_paid')), 0)::int as sold,
            coalesce((select sum(available_spots(t.id)) from ticket_types t where t.experience_id = e.id), 0)::int as remaining,
            coalesce((select sum(b.amount_aed_minor) from bookings b
                       where b.experience_id = e.id and b.status in ('paid', 'deposit_paid')), 0)::int as revenue,
            coalesce((select count(*) from booking_guests g join bookings b on b.id = g.booking_id
                       where b.experience_id = e.id and b.status in ('paid', 'deposit_paid')
                         and not g.details_complete), 0)::int as missing
       from experiences e
      where e.status <> 'draft'
        and (e.start_at is null or coalesce(e.end_at, e.start_at) >= $1)
      order by e.start_at nulls last, e.title`,
    [now.toISOString()],
  );
  return r.rows.map((x) => ({
    id: x.id, slug: x.slug, title: x.title, type: x.type, status: x.status,
    startAt: iso(x.start_at), endAt: iso(x.end_at), timezone: x.timezone,
    capacity: x.capacity, sold: x.sold, remaining: x.remaining,
    revenueAedMinor: x.revenue, missingDetails: x.missing,
  }));
}

/**
 * Whole-business totals. Experience revenue is booking money only; gift card sales are a separate
 * figure (not revenue until the card is spent, which then shows up as gift applied on a booking).
 */
export async function loadRevenue(db: SqlClient): Promise<{ experienceAedMinor: number; giftSalesAedMinor: number }> {
  const r = await db.query<{ exp: number; gift: number }>(
    `select coalesce((select sum(amount_aed_minor) from bookings where status in ('paid', 'deposit_paid')), 0)::int as exp,
            coalesce((select sum(amount_aed_minor) from gift_card_ledger where reason = 'issue'), 0)::int as gift`,
  );
  return { experienceAedMinor: r.rows[0].exp, giftSalesAedMinor: r.rows[0].gift };
}
