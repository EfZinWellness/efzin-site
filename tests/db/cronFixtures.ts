import type { PGlite } from "@electric-sql/pglite";
import { sendEmail, setEmailTransport, type EmailKind, type OutgoingEmail, type SendEmailFn } from "../../lib/email/send";

export interface Captured {
  kind: string;
  to: string;
  subject: string;
  text: string;
  attachments: string[];
}

/**
 * The real sendEmail (rendering + email_log dedupe against `db`) with a capturing transport.
 * `sendEmail` passed to jobs is the real one; the db comes from the job's own argument.
 */
export function captureEmails(): { sent: Captured[]; send: SendEmailFn; restore: () => void; fail: (on: boolean) => void } {
  const sent: Captured[] = [];
  let failing = false;
  setEmailTransport(async (msg: OutgoingEmail) => {
    if (failing) throw new Error("transport down");
    sent.push({
      kind: msg.tags?.find((t) => t.name === "kind")?.value ?? "",
      to: msg.to.join(","),
      subject: msg.subject,
      text: msg.text,
      attachments: (msg.attachments ?? []).map((a) => a.filename),
    });
  });
  return { sent, send: sendEmail, restore: () => setEmailTransport(null), fail: (on) => (failing = on) };
}

export const kinds = (sent: Captured[]) => sent.map((s) => `${s.kind}>${s.to}`).sort();

export async function person(db: PGlite, name: string, email: string, customer: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into people (name, email, stripe_customer_id) values ($1, $2, $3) returning id",
    [name, email, customer],
  );
  return r.rows[0].id;
}

export interface SeedItem {
  seq: number;
  dueOn: string;
  amount: number;
  status: "scheduled" | "paid" | "failed" | "cancelled";
  invoice?: string;
}

export interface SeedBooking {
  slug: "test-retreat" | "test-event";
  status: "paid" | "deposit_paid" | "cancelled" | "refunded";
  booker: { name: string; email: string; customer?: string; detailsComplete?: boolean };
  guests?: { name: string; email: string; detailsComplete?: boolean }[];
  items?: SeedItem[];
  createdAt?: string;
}

/** Inserts a booking directly (no checkout), with guests and schedule items. */
export async function seedBooking(db: PGlite, s: SeedBooking): Promise<{ bookingId: string; itemIds: Record<number, string>; ticketId: string }> {
  const exp = (
    await db.query<{ id: string; base_currency: string; total_price_minor: number | null; tt: string; template: string }>(
      `select e.id, e.base_currency, e.total_price_minor, e.policy_template as template,
              (select id from ticket_types where experience_id = e.id order by key limit 1) as tt
         from experiences e where slug = $1`,
      [s.slug],
    )
  ).rows[0];
  const booker = await person(db, s.booker.name, s.booker.email, s.booker.customer ?? null);
  const items = s.items ?? [];
  const paidBase = items.filter((i) => i.status === "paid").reduce((t, i) => t + i.amount, 0);
  const total = exp.total_price_minor ?? items.reduce((t, i) => t + i.amount, 0);
  const b = await db.query<{ id: string }>(
    `insert into bookings (booker_person_id, experience_id, status, amount_paid_minor, presentment_currency, amount_aed_minor,
                           amount_paid_base_minor, base_currency, payment_option, total_price_minor, policy_snapshot, created_at)
     values ($1, $2, $3, $4, $5, $4, $4, $5, $6, $7, $8::jsonb, $9) returning id`,
    [
      booker,
      exp.id,
      s.status,
      paidBase,
      exp.base_currency,
      items.length > 1 ? "deposit_balance" : "full",
      total,
      JSON.stringify({ template: exp.template, copy: [] }),
      s.createdAt ?? "2027-01-10T09:00:00Z",
    ],
  );
  const bookingId = b.rows[0].id;
  await db.query(
    "insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker, details_complete) values ($1, $2, $3, true, $4)",
    [bookingId, booker, exp.tt, s.booker.detailsComplete ?? false],
  );
  for (const g of s.guests ?? []) {
    const pid = await person(db, g.name, g.email);
    await db.query(
      "insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker, details_complete) values ($1, $2, $3, false, $4)",
      [bookingId, pid, exp.tt, g.detailsComplete ?? false],
    );
  }
  const itemIds: Record<number, string> = {};
  for (const i of items) {
    const r = await db.query<{ id: string }>(
      `insert into payment_schedule_items (booking_id, seq, due_on, amount_minor, currency, status, stripe_invoice_id, paid_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [bookingId, i.seq, i.dueOn, i.amount, exp.base_currency, i.status, i.invoice ?? null, i.status === "paid" ? "2027-01-10T09:00:00Z" : null],
    );
    itemIds[i.seq] = r.rows[0].id;
  }
  return { bookingId, itemIds, ticketId: exp.tt };
}

export type { EmailKind };
