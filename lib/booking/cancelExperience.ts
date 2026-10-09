import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient } from "../content/sync";
import { renderEmail } from "../email/render";
import type { SendEmailFn } from "../email/send";
import type { StripeApi } from "../stripe/client";
import { cancelBooking, type CancelOutcome } from "./cancel";

export interface CancelExperienceOptions {
  now: Date;
  sendEmail: SendEmailFn;
  origin: string;
  /** Where the dry run writes the email preview (default `.superpowers/cancellations`, gitignored). */
  outDir?: string;
}

export interface CancelExperienceResult {
  bookings: number;
  previewFile: string | null;
  outcomes: CancelOutcome[];
}

type Row = {
  id: string;
  title: string;
  start_at: string | Date | null;
  timezone: string;
  booker_name: string;
  booker_email: string;
  guests: string[];
  paid_base: number | null;
  base_currency: string | null;
  gift_aed: number;
  gift_base: number;
  credit_base: number;
};

const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

/**
 * Ef Zin cancels an experience: every active booking is cancelled with `cancelledBy: 'efzin'`
 * (full refund, no fee deduction; gift parts back to the gift cards, or credit when a card has
 * expired) and every guest is emailed.
 *
 * `dry-run` changes nothing and calls no Stripe API: it writes the affected bookings and the
 * guest email (rendered) to a file for Tanya to approve. `send` does it for real.
 */
export async function runCancelExperience(
  db: SqlClient,
  stripe: StripeApi | null,
  slug: string,
  mode: "dry-run" | "send",
  opts: CancelExperienceOptions,
): Promise<CancelExperienceResult> {
  const r = await db.query<Row>(
    `select b.id, e.title, e.start_at, e.timezone, p.name as booker_name, p.email as booker_email,
            array(select gp.email from booking_guests g join people gp on gp.id = g.person_id
                   where g.booking_id = b.id and gp.id <> b.booker_person_id order by gp.email) as guests,
            b.amount_paid_base_minor as paid_base, coalesce(b.base_currency, e.base_currency) as base_currency,
            b.gift_card_applied_aed_minor as gift_aed, b.gift_card_applied_base_minor as gift_base,
            b.credit_applied_base_minor as credit_base
       from bookings b
       join experiences e on e.id = b.experience_id
       join people p on p.id = b.booker_person_id
      where e.slug = $1 and b.status in ('paid', 'deposit_paid')
      order by b.created_at`,
    [slug],
  );
  const rows = r.rows;

  if (mode === "dry-run") {
    const first = rows[0];
    const sample = await renderEmail("booking_cancelled", {
      name: first?.booker_name ?? "Layla Haddad",
      experience: first?.title ?? slug,
      startsAt: first?.start_at ? new Date(first.start_at).toISOString() : null,
      timezone: first?.timezone,
      byEfzin: true,
      cardRefunds: first ? [{ amountMinor: cardPart(first), currency: first.base_currency ?? "AED" }] : [],
      giftCardAed: first?.gift_aed ?? 0,
    });
    const lines = [
      `Cancel ${first?.title ?? slug} (${slug}): ${rows.length} booking(s). DRY RUN: nothing has been changed or refunded.`,
      "",
      "Affected bookings (full refund, no fees deducted; amounts paid by card are refunded in the currency charged):",
      ...rows.map(
        (b) =>
          `- ${b.booker_name} <${b.booker_email}>${b.guests.length ? `, guests: ${b.guests.join(", ")}` : ""}: card ${money(
            cardPart(b),
            b.base_currency ?? "AED",
          )}${b.gift_aed > 0 ? `, gift card AED ${(b.gift_aed / 100).toFixed(2)} returned` : ""}`,
      ),
      "",
      `Email to each booker (guests get a short version). Subject: ${sample.subject}`,
      "",
      sample.text,
      "",
      `To send: npx tsx scripts/cancel-experience.ts ${slug} --send`,
    ];
    const dir = opts.outDir ?? join(process.cwd(), ".superpowers", "cancellations");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `cancel-${slug}-${opts.now.toISOString().replace(/[:.]/g, "-")}.txt`);
    writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    return { bookings: rows.length, previewFile: file, outcomes: [] };
  }

  const outcomes: CancelOutcome[] = [];
  for (const b of rows) {
    outcomes.push(
      await cancelBooking(db, stripe, b.id, "refund", "efzin", opts.now, {
        sendEmail: opts.sendEmail,
        origin: opts.origin,
        notifyWaitlist: false,
      }),
    );
  }
  return { bookings: rows.length, previewFile: null, outcomes };
}

/** What was paid by card, in the base currency (paid minus gift and credit). */
const cardPart = (b: Row) => Math.max(0, (b.paid_base ?? 0) - b.gift_base - b.credit_base);
