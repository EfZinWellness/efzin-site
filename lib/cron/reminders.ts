import { dubaiToday } from "../giftcards/dates";
import { calendarDate } from "../payments/schedule";
import { addDays, daysBetween, endOfDubaiDay, mail, type JobContext } from "./context";

type GuestRow = {
  guest_id: string;
  name: string;
  email: string;
  details_complete: boolean;
  title: string;
  slug: string;
  type: string;
  start_at: string | Date;
  end_at: string | Date | null;
  timezone: string;
  venue: string | null;
};

const pageOf = (origin: string, type: string, slug: string) => `${origin}/${type === "retreat" ? "retreats" : "events"}/${slug}`;

/** The next experience on sale after `now` (for "what's next" links). */
async function upcoming(ctx: JobContext, limit: number) {
  const r = await ctx.db.query<{ title: string; slug: string; type: string; start_at: string | Date; timezone: string }>(
    `select title, slug, type, start_at, timezone from experiences
      where status = 'on_sale' and start_at > $1 order by start_at limit $2`,
    [ctx.now.toISOString(), limit],
  );
  return r.rows.map((e) => ({
    title: e.title,
    url: pageOf(ctx.origin, e.type, e.slug),
    startsAt: new Date(e.start_at).toISOString(),
    timezone: e.timezone,
  }));
}

/**
 * Guest emails around an experience, by calendar day in the experience's timezone:
 * `details_reminder` 3 days before (details incomplete), `day_before` to every guest, and
 * `day_after` the day after it ends. Only guests on paid or part-paid bookings; once per guest.
 */
export async function remindGuests(ctx: JobContext): Promise<number> {
  const r = await ctx.db.query<GuestRow>(
    `select g.id as guest_id, p.name, p.email, g.details_complete, e.title, e.slug, e.type, e.start_at, e.end_at,
            e.timezone, e.venue
       from booking_guests g
       join bookings b on b.id = g.booking_id
       join people p on p.id = g.person_id
       join experiences e on e.id = b.experience_id
      where b.status in ('paid', 'deposit_paid') and e.start_at is not null
        and e.start_at <= $1::timestamptz + interval '4 days'
        and coalesce(e.end_at, e.start_at) >= $1::timestamptz - interval '2 days'
      order by e.start_at, p.email`,
    [ctx.now.toISOString()],
  );
  let next: Awaited<ReturnType<typeof upcoming>> | null = null;
  let n = 0;
  for (const g of r.rows) {
    const today = calendarDate(ctx.now, g.timezone);
    const startDay = calendarDate(new Date(g.start_at), g.timezone);
    const endDay = calendarDate(new Date(g.end_at ?? g.start_at), g.timezone);
    const untilStart = daysBetween(startDay, today);
    const base = {
      name: g.name,
      experience: g.title,
      startsAt: new Date(g.start_at).toISOString(),
      timezone: g.timezone,
    };
    if (untilStart === 3 && !g.details_complete) {
      await mail(ctx, "details_reminder", g.email, { ...base, detailsLink: `${ctx.origin}/account` }, g.guest_id);
      n++;
    }
    if (untilStart === 1) {
      await mail(ctx, "day_before", g.email, { ...base, venue: g.venue, experienceUrl: pageOf(ctx.origin, g.type, g.slug) }, g.guest_id);
      n++;
    }
    if (daysBetween(today, endDay) === 1) {
      next ??= await upcoming(ctx, 1);
      const nx = next[0];
      await mail(
        ctx,
        "day_after",
        g.email,
        { ...base, ...(nx ? { nextTitle: nx.title, nextUrl: nx.url, nextStartsAt: nx.startsAt, nextTimezone: nx.timezone } : {}) },
        g.guest_id,
      );
      n++;
    }
  }
  return n;
}

/** `credit_expiring` once per credit, when it has 30 days or fewer left (Dubai dates) and is unused. */
export async function remindExpiringCredits(ctx: JobContext): Promise<number> {
  const until = endOfDubaiDay(addDays(dubaiToday(ctx.now), 30));
  const r = await ctx.db.query<{ id: string; code: string | null; amount_aed_minor: number; expires_at: string | Date; name: string; email: string }>(
    `select c.id, c.code, c.amount_aed_minor, c.expires_at, p.name, p.email
       from credits c join people p on p.id = c.person_id
      where c.redeemed_booking_id is null and c.expires_at > $1 and c.expires_at < $2
      order by c.expires_at`,
    [ctx.now.toISOString(), until.toISOString()],
  );
  for (const c of r.rows) {
    await mail(
      ctx,
      "credit_expiring",
      c.email,
      {
        name: c.name,
        code: c.code ?? "",
        amountAedMinor: c.amount_aed_minor,
        expiresOn: dubaiToday(new Date(c.expires_at)),
        eventsUrl: `${ctx.origin}/events`,
      },
      c.id,
    );
  }
  return r.rows.length;
}

/**
 * `gift_card_expiring` once per card with value left and 30 days or fewer to go, to its holder:
 * the member who used it, else the recipient, else (a gift to themselves) the buyer. Unassigned
 * cards from a bulk purchase have no known holder and are skipped.
 */
export async function remindExpiringGiftCards(ctx: JobContext): Promise<number> {
  const until = endOfDubaiDay(addDays(dubaiToday(ctx.now), 30));
  const r = await ctx.db.query<{ id: string; code: string; balance_aed_minor: number; expires_at: string | Date; name: string; email: string }>(
    `select g.id, g.code, g.balance_aed_minor, g.expires_at,
            coalesce(rp.name, g.recipient_name, bp.name) as name,
            coalesce(rp.email, g.recipient_email, bp.email) as email
       from gift_cards g
       join people bp on bp.id = g.buyer_person_id
       left join people rp on rp.id = g.recipient_person_id
       left join gift_card_batches bt on bt.id = g.purchase_batch_id
      where g.status = 'active' and g.balance_aed_minor > 0 and g.expires_at > $1 and g.expires_at < $2
        and (g.recipient_person_id is not null or g.recipient_email is not null or coalesce(bt.quantity, 1) = 1)
      order by g.expires_at`,
    [ctx.now.toISOString(), until.toISOString()],
  );
  if (r.rows.length === 0) return 0;
  const next = await upcoming(ctx, 3);
  for (const g of r.rows) {
    await mail(
      ctx,
      "gift_card_expiring",
      g.email,
      { name: g.name, code: g.code, balanceAedMinor: g.balance_aed_minor, expiresOn: dubaiToday(new Date(g.expires_at)), upcoming: next },
      g.id,
    );
  }
  return r.rows.length;
}
