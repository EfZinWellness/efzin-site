import type { Experience } from "./schema";

/** Minimal query interface: satisfied by PGlite (tests) and a thin wrapper over `pg` (production). */
export interface SqlClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export type SyncReport = { upserted: string[]; errors: string[] };

const SOLD_STATUSES = ["paid", "deposit_paid"];

/**
 * Copies booking-relevant fields from content files into Postgres.
 * Never deletes. An experience is skipped (with an error) if any ticket's new
 * capacity is below the number of guests already sold on it.
 */
export async function syncContent(db: SqlClient, experiences: Experience[]): Promise<SyncReport> {
  const report: SyncReport = { upserted: [], errors: [] };

  for (const e of experiences) {
    try {
      const existing = await db.query<{ id: string }>("select id from experiences where slug = $1", [e.slug]);
      const existingId = existing.rows[0]?.id;

      if (existingId) {
        const violations: string[] = [];
        for (const t of e.tickets) {
          const r = await db.query<{ sold: number }>(
            `select count(bg.id)::int as sold
               from ticket_types tt
               left join booking_guests bg on bg.ticket_type_id = tt.id
               left join bookings b on b.id = bg.booking_id and b.status = any($3)
              where tt.experience_id = $1 and tt.key = $2
                and (bg.id is null or b.id is not null)
              group by tt.id`,
            [existingId, t.key, SOLD_STATUSES],
          );
          const sold = r.rows[0]?.sold ?? 0;
          if (t.capacity < sold) {
            violations.push(`ticket "${t.key}" capacity ${t.capacity} is below ${sold} already sold`);
          }
        }
        if (violations.length) {
          report.errors.push(`${e.slug}: ${violations.join("; ")}; skipped`);
          continue;
        }
      }

      const up = await db.query<{ id: string }>(
        `insert into experiences
           (slug, type, title, start_at, end_at, venue, pillars, status, base_currency,
            policy_template, deposit_pct, total_price_minor, timezone)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (slug) do update set
           type = excluded.type, title = excluded.title, start_at = excluded.start_at,
           end_at = excluded.end_at, venue = excluded.venue, pillars = excluded.pillars,
           status = excluded.status, base_currency = excluded.base_currency,
           policy_template = excluded.policy_template, deposit_pct = excluded.deposit_pct,
           total_price_minor = excluded.total_price_minor, timezone = excluded.timezone
         returning id`,
        [
          e.slug,
          e.type,
          e.title,
          e.startsAt,
          e.endsAt,
          e.venue.name,
          e.pillars,
          e.status,
          e.baseCurrency,
          e.policy,
          e.depositPct ?? null,
          e.totalPriceMinor ?? null,
          e.timezone,
        ],
      );
      const id = up.rows[0].id;

      for (const t of e.tickets) {
        await db.query(
          `insert into ticket_types (experience_id, key, name, price_minor, capacity)
           values ($1,$2,$3,$4,$5)
           on conflict (experience_id, key) do update set
             name = excluded.name, price_minor = excluded.price_minor, capacity = excluded.capacity`,
          [id, t.key, t.name, t.priceMinor, t.capacity],
        );
      }
      report.upserted.push(e.slug);
    } catch (err) {
      report.errors.push(`${e.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return report;
}
