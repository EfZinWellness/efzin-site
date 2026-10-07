import type { Pool } from "pg";

let pool: Pool | null = null;

/** One shared, lazily created pool for the whole server process. */
async function getPool(url: string): Promise<Pool> {
  if (!pool) {
    const { Pool: PgPool } = await import("pg");
    pool = new PgPool({ connectionString: url, max: 3, connectionTimeoutMillis: 3000 });
  }
  return pool;
}

/**
 * Spots left per ticket key for several experiences in one query, via the
 * `available_spots` DB function. Returns null when no database is configured or the
 * query fails; pages then simply hide the "Only N spots left" text.
 */
export async function getSpotsLeftMany(
  slugs: string[],
): Promise<Record<string, Record<string, number>> | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (slugs.length === 0) return {};
  try {
    const res = await (await getPool(url)).query<{ slug: string; key: string; n: number }>(
      `select e.slug, tt.key, available_spots(tt.id)::int as n
         from ticket_types tt join experiences e on e.id = tt.experience_id
        where e.slug = any($1)`,
      [slugs],
    );
    const out: Record<string, Record<string, number>> = {};
    for (const r of res.rows) (out[r.slug] ??= {})[r.key] = r.n;
    return out;
  } catch {
    return null;
  }
}

export async function getSpotsLeft(slug: string): Promise<Record<string, number> | null> {
  const many = await getSpotsLeftMany([slug]);
  return many ? (many[slug] ?? {}) : null;
}

/** Smallest remaining count across ticket types, or null when unknown. */
export function minSpots(spots: Record<string, number> | null | undefined): number | null {
  if (!spots) return null;
  const v = Object.values(spots);
  return v.length ? Math.min(...v) : null;
}