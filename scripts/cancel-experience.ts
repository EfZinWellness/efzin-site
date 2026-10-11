/**
 * Ef Zin cancels an experience (used by Claude when Tanya asks).
 *
 *   npx tsx scripts/cancel-experience.ts <slug> --dry-run   # writes the booker email to .superpowers/cancellations/ for approval
 *   npx tsx scripts/cancel-experience.ts <slug> --send      # cancels every booking; each booker chooses refund or credit
 *
 * --send cancels the bookings and frees the spots straight away but moves no money: each booker
 * gets a link to choose a full refund or the full amount as credit; after 7 days without a
 * choice the daily job refunds in full. Choices are listed on /admin/payments.
 *
 * Needs DATABASE_URL (and SUPABASE_DB_CA_CERT for Supabase); --send also needs STRIPE_SECRET_KEY
 * and RESEND_API_KEY. After --send, set the experience's status in its content file (e.g. `past`)
 * and sync, so it can't be booked again.
 */
import { Pool } from "pg";
import { runCancelExperience } from "../lib/booking/cancelExperience";
import type { SqlClient } from "../lib/content/sync";
import { poolConfig } from "../lib/db/pool";
import { sendEmail } from "../lib/email/send";
import { getStripe } from "../lib/stripe/client";
import { SITE_URL } from "../lib/site";

async function main(): Promise<number> {
  const [slug, flag] = process.argv.slice(2);
  if (!slug || (flag !== "--dry-run" && flag !== "--send")) {
    console.error("usage: tsx scripts/cancel-experience.ts <slug> --dry-run|--send");
    return 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    return 1;
  }
  const stripe = flag === "--send" ? getStripe() : null;
  if (flag === "--send" && !stripe) {
    console.error("STRIPE_SECRET_KEY is not set");
    return 1;
  }
  // One connection, so the cancellation transactions run on the same session.
  const pool = new Pool({ ...poolConfig(url), max: 1 });
  const conn = await pool.connect();
  const db: SqlClient = {
    async query<T = unknown>(sql: string, params?: unknown[]) {
      const r = await conn.query(sql, params);
      return { rows: r.rows as T[] };
    },
  };
  try {
    const result = await runCancelExperience(db, stripe, slug, flag === "--send" ? "send" : "dry-run", {
      now: new Date(),
      sendEmail,
      origin: (process.env.NEXT_PUBLIC_SITE_ORIGIN || SITE_URL).replace(/\/+$/, ""),
    });
    if (result.previewFile) {
      console.log(`${result.bookings} booking(s). Preview written to ${result.previewFile}`);
      return 0;
    }
    for (const o of result.outcomes) {
      const what = !o.cancelled
        ? "already inactive, unchanged"
        : o.emailSent
          ? "cancelled, refund-or-credit choice emailed"
          : "cancelled, but the choice email FAILED (Tanya alerted; use 'Resend choice email' on /admin/payments)";
      const line = `${o.bookingId}: ${what}${o.problems.length ? ` (problems: ${o.problems.join("; ")})` : ""}`;
      if (o.cancelled && !o.emailSent) console.error(line);
      else console.log(line);
    }
    for (const f of result.failures) console.error(`${f.bookingId}: NOT cancelled (${f.error})`);
    console.log(
      `${result.outcomes.filter((o) => o.cancelled).length} of ${result.bookings} booking(s) cancelled. Now set the experience's status in its content file and sync.`,
    );
    const unsent = result.outcomes.filter((o) => o.cancelled && !o.emailSent).length;
    if (unsent > 0) console.error(`${unsent} choice email(s) NOT sent: resend them from /admin/payments.`);
    return result.failures.length > 0 || unsent > 0 || result.outcomes.some((o) => o.problems.length > 0) ? 1 : 0;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
