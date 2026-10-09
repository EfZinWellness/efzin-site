import type { SqlClient } from "../content/sync";
import { upsertPersonByEmail } from "../people/upsert";
import { parseCsvRecords, pick } from "./csv";

/** Product name -> experience slug, or { slug, ticket } to choose a ticket type by key. */
export type ProductMap = Record<string, string | { slug: string; ticket?: string }>;

export interface ImportOptions {
  /** Do everything, report the counts, then roll back. */
  dryRun?: boolean;
  /** Import time, used as marketing_consent_at. Defaults to now. */
  now?: Date;
}

export interface ImportResult {
  /** People created by this run (existing people are matched by email, not counted). */
  people: number;
  /** Bookings created by this run. A rerun reports 0. */
  bookings: number;
  /** Product names with no entry in the map; their order lines are not imported. */
  unmapped: string[];
  /** Mapped slugs (or slug#ticket) that are not in the database yet: run the content sync first. */
  missingExperiences: string[];
  /** Rows with no email address. */
  skippedNoEmail: number;
  /** Order rows with no order id, product name or readable price. */
  skippedInvalid: number;
  /** external_refs of bookings in a currency other than AED, stored with amount_aed_minor = 0. */
  needsAedConversion: string[];
  /** The unmapped products with how many lines used them and the first and last order dates (YYYY-MM-DD). */
  unmappedDetail: UnmappedProduct[];
  /** Order ids skipped because their Financial/Payment Status is refunded, cancelled, voided or pending. */
  skippedStatus: string[];
  /** Imported lines whose date was missing, unreadable or had no timezone (booking date falls back to the parsed value or now). */
  unparseableDates: number;
}

export interface UnmappedProduct {
  name: string;
  count: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
}

const ORDER_LEVEL = [
  "email", "customer email", "billing name", "name", "created at", "paid at", "order date",
  "currency", "financial status", "payment status",
];
const SKIP_STATUS = new Set(["refunded", "cancelled", "canceled", "voided", "pending"]);
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i;

interface ExperienceInfo {
  id: string;
  startAt: Date | null;
  baseCurrency: string;
  tickets: { id: string; key: string }[];
}

const YES = new Set(["yes", "true", "y", "1", "subscribed", "accepts marketing"]);

function parseDate(s: string): Date | null {
  if (!s) return null;
  // Squarespace writes "2026-09-12 14:03:11 +0400"; make it ISO.
  const iso = s.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T").replace(/ ?([+-]\d{2})(\d{2})$/, "$1:$2").replace(/ ?Z$/, "Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMinor(price: string): number | null {
  const cleaned = price.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export async function importSquarespace(
  db: SqlClient,
  customersCsv: string,
  ordersCsv: string,
  map: ProductMap,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const now = opts.now ?? new Date();
  const result: ImportResult = {
    people: 0,
    bookings: 0,
    unmapped: [],
    missingExperiences: [],
    skippedNoEmail: 0,
    skippedInvalid: 0,
    needsAedConversion: [],
    unmappedDetail: [],
    skippedStatus: [],
    unparseableDates: 0,
  };

  const products = new Map<string, { slug: string; ticket?: string }>();
  for (const [name, v] of Object.entries(map)) {
    products.set(name.trim().toLowerCase(), typeof v === "string" ? { slug: v } : v);
  }

  const experiences = new Map<string, ExperienceInfo | null>();
  async function experience(slug: string): Promise<ExperienceInfo | null> {
    if (experiences.has(slug)) return experiences.get(slug)!;
    const e = await db.query<{ id: string; start_at: string | null; base_currency: string }>(
      "select id, start_at, base_currency from experiences where slug = $1",
      [slug],
    );
    let info: ExperienceInfo | null = null;
    if (e.rows[0]) {
      const t = await db.query<{ id: string; key: string }>(
        "select id, key from ticket_types where experience_id = $1 order by price_minor desc, key",
        [e.rows[0].id],
      );
      info = {
        id: e.rows[0].id,
        startAt: e.rows[0].start_at ? new Date(e.rows[0].start_at) : null,
        baseCurrency: e.rows[0].base_currency,
        tickets: t.rows,
      };
    }
    experiences.set(slug, info);
    return info;
  }

  async function person(email: string, name: string, phone: string, subscribed: boolean): Promise<string> {
    const existing = await db.query<{ id: string }>("select id from people where lower(email) = lower($1)", [email]);
    const id = await upsertPersonByEmail(db, { email, name, phone });
    if (!existing.rows[0]) {
      await db.query("update people set imported_from = 'squarespace' where id = $1", [id]);
      result.people++;
    }
    if (subscribed) {
      await db.query(
        `update people set marketing_consent = true, marketing_consent_at = $2
          where id = $1 and marketing_consent = false and marketing_consent_withdrawn_at is null`,
        [id, now.toISOString()],
      );
    }
    return id;
  }

  const unmapped = new Map<string, UnmappedProduct>();
  const missing = new Set<string>();
  const statusSkipped = new Set<string>();

  await db.query("begin");
  try {
    for (const rec of parseCsvRecords(customersCsv)) {
      const email = pick(rec, "email", "email address");
      if (!email) {
        result.skippedNoEmail++;
        continue;
      }
      const name = [pick(rec, "first name", "firstname"), pick(rec, "last name", "lastname")].filter(Boolean).join(" ");
      const subscribed = YES.has(pick(rec, "accepts marketing", "subscribed to marketing", "subscribed").toLowerCase());
      await person(email, name, pick(rec, "phone", "phone number", "billing phone"), subscribed);
    }

    const lineCounter = new Map<string, number>();
    // Extra line-item rows of an order often leave the order-level columns blank: carry them forward.
    const carried = new Map<string, Record<string, string>>();
    for (const rec of parseCsvRecords(ordersCsv)) {
      const orderId = pick(rec, "order id", "order number", "order");
      if (!orderId) {
        result.skippedInvalid++;
        continue;
      }
      // The line index is the row's position within its order and advances for every row,
      // skipped or not, so refs stay stable.
      const lineIndex = lineCounter.get(orderId) ?? 0;
      lineCounter.set(orderId, lineIndex + 1);

      const prev = carried.get(orderId) ?? {};
      for (const k of ORDER_LEVEL) {
        if (rec[k]) prev[k] ??= rec[k];
        else if (prev[k]) rec[k] = prev[k];
      }
      carried.set(orderId, prev);

      const email = pick(rec, "email", "customer email");
      const product = pick(rec, "lineitem name", "product name", "item");
      if (!email) {
        result.skippedNoEmail++;
        continue;
      }
      const status = pick(rec, "financial status", "payment status").toLowerCase();
      if (SKIP_STATUS.has(status)) {
        statusSkipped.add(orderId);
        continue;
      }
      if (!product) {
        result.skippedInvalid++;
        continue;
      }
      const dateText = pick(rec, "created at", "paid at", "order date");

      const target = products.get(product.trim().toLowerCase());
      if (!target) {
        const d = parseDate(dateText);
        const s = unmapped.get(product) ?? { name: product, count: 0, firstOrderDate: null, lastOrderDate: null };
        s.count++;
        if (d) {
          const day = d.toISOString().slice(0, 10);
          if (!s.firstOrderDate || day < s.firstOrderDate) s.firstOrderDate = day;
          if (!s.lastOrderDate || day > s.lastOrderDate) s.lastOrderDate = day;
        }
        unmapped.set(product, s);
        continue;
      }
      const exp = await experience(target.slug);
      const ticket = exp && (target.ticket ? exp.tickets.find((t) => t.key === target.ticket) : exp.tickets[0]);
      if (!exp || !ticket) {
        missing.add(exp && target.ticket ? `${target.slug}#${target.ticket}` : target.slug);
        continue;
      }

      const unit = toMinor(pick(rec, "lineitem price", "unit price", "price"));
      const qty = Math.max(1, Number.parseInt(pick(rec, "lineitem quantity", "quantity") || "1", 10) || 1);
      if (unit === null) {
        result.skippedInvalid++;
        continue;
      }
      const total = unit * qty;
      const currency = (pick(rec, "currency") || "AED").toUpperCase();
      const aed = currency === "AED" ? total : 0;
      const base = currency === exp.baseCurrency ? total : null;
      const ref = `sqsp:${orderId}:${lineIndex}`;
      const when = parseDate(dateText);
      if (!when || !HAS_TZ.test(dateText.trim())) result.unparseableDates++;

      const personId = await person(email, pick(rec, "billing name", "name"), "", false);
      const b = await db.query<{ id: string }>(
        `insert into bookings (booker_person_id, experience_id, status, amount_paid_minor, presentment_currency,
                               amount_aed_minor, amount_paid_base_minor, base_currency, imported, external_ref, created_at)
         values ($1, $2, 'paid', $3, $4, $5, $6, $7, true, $8, coalesce($9::timestamptz, now()))
         on conflict (external_ref) do nothing
         returning id`,
        [personId, exp.id, total, currency, aed, base, base === null ? null : exp.baseCurrency, ref, when?.toISOString() ?? null],
      );
      if (!b.rows[0]) continue; // already imported
      await db.query(
        `insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker, checked_in_at)
         values ($1, $2, $3, true, $4)`,
        [b.rows[0].id, personId, ticket.id, exp.startAt?.toISOString() ?? null],
      );
      result.bookings++;
      if (currency !== "AED") result.needsAedConversion.push(ref);
    }

    await db.query(opts.dryRun ? "rollback" : "commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }

  result.unmapped = [...unmapped.keys()];
  result.unmappedDetail = [...unmapped.values()];
  result.skippedStatus = [...statusSkipped];
  result.missingExperiences = [...missing];
  return result;
}
