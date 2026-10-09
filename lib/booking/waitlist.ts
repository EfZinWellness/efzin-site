import { z } from "zod";
import type { SqlClient } from "../content/sync";
import type { SendEmailFn } from "../email/send";

export type JoinResult = "joined" | "already" | "available" | "closed";

type TicketInfo = { id: string; slug: string; title: string; status: string; start_at: string | Date | null; spots: number };

async function ticketInfo(db: SqlClient, ticketTypeId: string): Promise<TicketInfo | null> {
  const r = await db.query<TicketInfo>(
    `select t.id, e.slug, e.title, e.status, e.start_at, available_spots(t.id) as spots
       from ticket_types t join experiences e on e.id = t.experience_id where t.id = $1`,
    [ticketTypeId],
  );
  return r.rows[0] ?? null;
}

const open = (t: TicketInfo, now: Date) =>
  (t.status === "on_sale" || t.status === "sold_out") && (t.start_at === null || new Date(t.start_at) > now);

/**
 * Adds an email to a ticket's waitlist (once per email). `available`: there are spots, book
 * instead. `closed`: the experience isn't selling (draft, past, started).
 */
export async function joinWaitlist(
  db: SqlClient,
  ticketTypeId: string,
  who: { name: string; email: string },
  now: Date,
): Promise<JoinResult> {
  const t = await ticketInfo(db, ticketTypeId);
  if (!t || !open(t, now)) return "closed";
  if (t.spots > 0) return "available";
  const r = await db.query<{ id: string }>(
    `insert into waitlist (ticket_type_id, name, email, position, created_at)
     values ($1, $2, lower($3), (select coalesce(max(position), 0) + 1 from waitlist where ticket_type_id = $1), $4)
     on conflict do nothing returning id`,
    [ticketTypeId, who.name.trim(), who.email.trim(), now.toISOString()],
  );
  return r.rows.length > 0 ? "joined" : "already";
}

export interface WaitlistDeps {
  sendEmail: SendEmailFn;
  origin: string;
  now: Date;
}

/**
 * When the ticket has spots (content on sale or marked sold out: booking is open for both and
 * the hold enforces capacity), emails everyone on its waitlist not yet notified
 * (first come, first served at checkout). Each email is claimed in email_log under
 * `waitlist:<ticket>` and the entry marked notified once sent; a failed send stays un-notified
 * and is retried by the next call. Returns how many were emailed.
 */
export async function notifyWaitlist(db: SqlClient, ticketTypeId: string, deps: WaitlistDeps): Promise<number> {
  const t = await ticketInfo(db, ticketTypeId);
  if (!t || !open(t, deps.now) || t.spots <= 0) return 0;
  const rows = await db.query<{ id: string; name: string | null; email: string }>(
    `select id, name, email from waitlist
      where ticket_type_id = $1 and notified_at is null and email is not null order by position, created_at`,
    [ticketTypeId],
  );
  let sent = 0;
  for (const r of rows.rows) {
    try {
      await deps.sendEmail(
        "waitlist_open",
        r.email,
        { name: r.name ?? "", experience: t.title, link: `${deps.origin}/book/${t.slug}` },
        undefined,
        { ref: `waitlist:${ticketTypeId}`, db },
      );
      await db.query("update waitlist set notified_at = $2 where id = $1", [r.id, deps.now.toISOString()]);
      sent++;
    } catch (err) {
      console.error("[waitlist] email failed", r.id, err);
    }
  }
  return sent;
}

const WaitlistSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  ticket: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().pipe(z.email().max(254)),
});

export interface WaitlistResponse {
  status: number;
  result?: JoinResult | "ignored";
  slug?: string;
  error?: string;
}

/** The public waitlist form (honeypot `website`; the route throttles by IP). */
export async function handleWaitlist(body: unknown, deps: { db: SqlClient | null; now: Date }): Promise<WaitlistResponse> {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (String(b.website ?? "").trim() !== "") return { status: 200, result: "ignored" };
  const parsed = WaitlistSchema.safeParse(b);
  if (!parsed.success) return { status: 400, error: "Please enter your name and a valid email address." };
  if (!deps.db) return { status: 503, error: "The waitlist is not available right now." };
  const { slug, ticket, name, email } = parsed.data;
  const t = await deps.db.query<{ id: string }>(
    `select t.id from ticket_types t join experiences e on e.id = t.experience_id
      where e.slug = $1 and e.status <> 'draft' and ($2::text is null or t.key = $2)
      order by t.price_minor desc, t.key limit 1`,
    [slug, ticket || null],
  );
  if (!t.rows[0]) return { status: 404, error: "We couldn't find that experience." };
  const result = await joinWaitlist(deps.db, t.rows[0].id, { name, email }, deps.now);
  // The same answer whether or not the email was already on the list (reveals nothing about others).
  return { status: 200, result: result === "already" ? "joined" : result, slug };
}
