import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient } from "../content/sync";
import { renderEmail } from "../email/render";
import { sendQuietly, type SendEmailFn } from "../email/send";
import { adminAddress } from "../requests/handlers";
import { dubaiToday } from "../giftcards/dates";
import type { StripeApi } from "../stripe/client";
import { cancelForChoice, CHOICE_DAYS, choiceUrl, type ChoiceOffer } from "./efzinChoice";

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
  outcomes: ChoiceOffer[];
  /** Bookings that could not be cancelled (left unchanged). */
  failures: { bookingId: string; error: string }[];
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
  amount_aed: number | null;
};

const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

/**
 * Ef Zin cancels an experience: every active booking is cancelled at once (spots freed, plans
 * stopped) and each booker is asked to choose a full refund or the full amount as credit
 * (lib/booking/efzinChoice.ts); no money moves until they choose or the deadline passes.
 *
 * `dry-run` changes nothing and calls no Stripe API: it writes the affected bookings and the
 * booker's choice email (rendered) to a file for Tanya to approve. `send` does it for real.
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
            b.credit_applied_base_minor as credit_base, b.amount_aed_minor as amount_aed
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
    const token = "<token>";
    const sample = await renderEmail("efzin_cancellation_choice", {
      name: first?.booker_name ?? "Layla Haddad",
      experience: first?.title ?? slug,
      startsAt: first?.start_at ? new Date(first.start_at).toISOString() : null,
      timezone: first?.timezone,
      amountMinor: first?.paid_base ?? 0,
      currency: first?.base_currency ?? "AED",
      creditAedMinor: first ? creditAed(first) : 0,
      giftCardAed: first?.gift_aed ?? 0,
      deadline: dubaiToday(new Date(opts.now.getTime() + CHOICE_DAYS * 86_400_000)),
      refundUrl: choiceUrl(opts.origin, token, "refund"),
      creditUrl: choiceUrl(opts.origin, token, "credit"),
    });
    const lines = [
      `Cancel ${first?.title ?? slug} (${slug}): ${rows.length} booking(s). DRY RUN: nothing has been changed or refunded.`,
      "",
      `--send cancels every booking and frees the spots at once, but moves no money: each booker chooses a full refund (no fees deducted; card amounts in the currency charged, gift card parts back to the gift card) or the full amount as AED credit (12 months). With no choice after ${CHOICE_DAYS} days the daily job refunds in full.`,
      "",
      "Affected bookings:",
      ...rows.map(
        (b) =>
          `- ${b.booker_name} <${b.booker_email}>${b.guests.length ? `, guests: ${b.guests.join(", ")}` : ""}: paid ${money(
            b.paid_base ?? 0,
            b.base_currency ?? "AED",
          )} (card ${money(cardPart(b), b.base_currency ?? "AED")}${b.gift_aed > 0 ? `, gift card AED ${(b.gift_aed / 100).toFixed(2)}` : ""}); as credit AED ${(creditAed(b) / 100).toFixed(2)}`,
      ),
      "",
      `Email to each booker (other guests get the short "your place is cancelled" note). Subject: ${sample.subject}`,
      "",
      sample.text,
      "",
      `To send: npx tsx scripts/cancel-experience.ts ${slug} --send`,
    ];
    const dir = opts.outDir ?? join(process.cwd(), ".superpowers", "cancellations");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `cancel-${slug}-${opts.now.toISOString().replace(/[:.]/g, "-")}.txt`);
    writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    return { bookings: rows.length, previewFile: file, outcomes: [], failures: [] };
  }

  const outcomes: ChoiceOffer[] = [];
  const failures: { bookingId: string; error: string }[] = [];
  for (const b of rows) {
    // One booking failing (rolled back) never stops the others; the failures are reported and
    // can be re-run.
    try {
      outcomes.push(await cancelForChoice(db, stripe, b.id, opts.now, { sendEmail: opts.sendEmail, origin: opts.origin }));
    } catch (err) {
      failures.push({ bookingId: b.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (failures.length > 0) {
    await sendQuietly(opts.sendEmail, "admin_error", adminAddress(), {
      context: "cancel_experience_failed",
      problem: `Cancelling ${slug}: ${failures.length} booking(s) could not be cancelled and were left unchanged. Run --send again to retry them.`,
      failures: failures.map((f) => `${f.bookingId}: ${f.error}`),
    });
  }
  return { bookings: rows.length, previewFile: null, outcomes, failures };
}

/** What was paid by card, in the base currency (paid minus gift and credit). */
const cardPart = (b: Row) => Math.max(0, (b.paid_base ?? 0) - b.gift_base - b.credit_base);

/** The credit option: the whole amount paid, in AED. */
const creditAed = (b: Row) => ((b.base_currency ?? "AED").toUpperCase() === "AED" ? (b.paid_base ?? 0) : (b.amount_aed ?? 0));
