import type { SqlClient } from "../content/sync";
import { aedDecimal } from "../giftcards/csv";
import { toCsv } from "./csv";
import { loadAdminGiftCards } from "./giftCards";
import { loadGuestList } from "./guests";
import { dubaiToday, loadPaymentsDue } from "./payments";
import { loadRequests } from "./requests";

export const EXPORT_KINDS = ["people", "bookings", "guests", "guests-health", "requests", "gift-cards", "payments-due"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export interface CsvExport {
  filename: string;
  /** CSV text without the byte order mark; the route adds it. */
  csv: string;
}

const aed = (minor: number | null): string => (minor === null ? "" : aedDecimal(minor));
const iso = (v: string | Date | null): string => (v === null ? "" : new Date(v).toISOString());

/**
 * Builds one CSV export, or null for an unknown kind or (for guest lists) an unknown experience.
 * Health columns exist ONLY in `guests-health`; no other export reads the health tables.
 */
export async function buildExport(
  db: SqlClient,
  kind: string,
  opts: { slug?: string | null; now?: Date },
): Promise<CsvExport | null> {
  const now = opts.now ?? new Date();
  const stamp = dubaiToday(now);
  const file = (name: string, csv: string): CsvExport => ({ filename: `efzin-${name}-${stamp}.csv`, csv });

  switch (kind) {
    case "people": {
      const r = await db.query<{
        name: string; email: string; phone: string | null; birthday: string | null; how_heard: string | null;
        marketing_consent: boolean; notes: string | null; created_at: string | Date; spent: number; n: number;
      }>(
        `select p.name, p.email, p.phone, to_char(p.birthday, 'YYYY-MM-DD') as birthday, p.how_heard,
                p.marketing_consent, p.notes, p.created_at,
                coalesce((select sum(b.amount_aed_minor) from bookings b where b.booker_person_id = p.id and b.status in ('paid', 'deposit_paid')), 0)::int as spent,
                (select count(*) from bookings b where b.booker_person_id = p.id and b.status in ('paid', 'deposit_paid'))::int as n
           from people p order by p.name, p.id`,
      );
      return file(
        "people",
        toCsv(
          ["name", "email", "phone", "birthday", "how_heard", "marketing_consent", "notes", "created_at", "total_spent_aed", "bookings"],
          r.rows.map((x) => [x.name, x.email, x.phone, x.birthday, x.how_heard, x.marketing_consent, x.notes, iso(x.created_at), aed(x.spent), x.n]),
        ),
      );
    }
    case "bookings": {
      const r = await db.query<{
        id: string; created_at: string | Date; title: string; name: string; email: string; status: string;
        amount: number | null; gift: number; credit: number; option: string | null; guests: number;
        imported: boolean; cancel_reason: string | null;
      }>(
        `select b.id, b.created_at, e.title, p.name, p.email, b.status, b.amount_aed_minor as amount,
                b.gift_card_applied_aed_minor as gift, b.credit_applied_aed_minor as credit,
                b.payment_option as option, (select count(*) from booking_guests g where g.booking_id = b.id)::int as guests,
                b.imported, b.cancel_reason
           from bookings b join experiences e on e.id = b.experience_id join people p on p.id = b.booker_person_id
          order by b.created_at desc, b.id`,
      );
      return file(
        "bookings",
        toCsv(
          ["booking_id", "created_at", "experience", "booker_name", "booker_email", "status", "amount_aed", "gift_card_applied_aed", "credit_applied_aed", "payment_option", "guests", "imported", "cancel_reason"],
          r.rows.map((x) => [x.id, iso(x.created_at), x.title, x.name, x.email, x.status, aed(x.amount), aed(x.gift), aed(x.credit), x.option, x.guests, x.imported, x.cancel_reason]),
        ),
      );
    }
    case "guests":
    case "guests-health": {
      if (!opts.slug) return null;
      const list = await loadGuestList(db, opts.slug);
      if (!list) return null;
      const withHealth = kind === "guests-health";
      const head = ["name", "email", "phone", "ticket", "booked_by", "details_complete", "waiver", "checked_in"];
      const healthHead = ["conditions", "injuries", "pregnancy", "allergies", "dietary"];
      return file(
        `${kind}-${list.experience.slug}`,
        toCsv(
          withHealth ? [...head, ...healthHead] : head,
          list.guests.map((g) => {
            const row = [g.name, g.email, g.phone, g.ticket, g.bookerName, g.detailsComplete, g.waiver, g.checkedIn];
            return withHealth
              ? [...row, g.health?.conditions ?? "", g.health?.injuries ?? "", g.health?.pregnancy ?? "", g.health?.allergies ?? "", g.health?.dietary ?? ""]
              : row;
          }),
        ),
      );
    }
    case "requests": {
      const rows = await loadRequests(db, 5000);
      return file(
        "requests",
        toCsv(
          ["created_at", "type", "status", "name", "email", "details"],
          rows.map((x) => [x.createdAt, x.type, x.status, x.personName, x.personEmail, JSON.stringify(x.payload)]),
        ),
      );
    }
    case "gift-cards": {
      const { cards } = await loadAdminGiftCards(db);
      return file(
        "gift-cards",
        toCsv(
          ["code", "status", "value_aed", "balance_aed", "expires_at", "bought_at", "buyer_name", "buyer_email", "recipient_name", "recipient_email"],
          cards.map((c) => [c.code, c.status, aed(c.initialAedMinor), aed(c.balanceAedMinor), c.expiresAt ?? "", c.createdAt, c.buyerName, c.buyerEmail, c.recipientName, c.recipientEmail]),
        ),
      );
    }
    case "payments-due": {
      const p = await loadPaymentsDue(db, stamp);
      const rows = [
        ...p.attention.map((i) => ({ list: "chase", i })),
        ...p.dueSoon.map((i) => ({ list: "due_soon", i })),
      ];
      return file(
        "payments-due",
        toCsv(
          ["list", "due_on", "experience", "instalment", "amount", "currency", "status", "attempts", "why", "booker_name", "booker_email", "booker_phone"],
          rows.map(({ list, i }) => [list, i.dueOn, i.title, i.seq, (i.amountMinor / 100).toFixed(2), i.currency, i.status, i.attempts, i.reasons.join(" "), i.bookerName, i.bookerEmail, i.bookerPhone]),
        ),
      );
    }
    default:
      return null;
  }
}
