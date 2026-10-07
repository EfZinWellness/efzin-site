/**
 * Spots left per ticket key for an experience, via the `available_spots` DB function.
 * Returns null when no database is configured or the query fails; pages then simply
 * hide the "Only N spots left" text.
 */
export async function getSpotsLeft(slug: string): Promise<Record<string, number> | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });
    try {
      const res = await pool.query<{ key: string; n: number }>(
        `select tt.key, available_spots(tt.id)::int as n
           from ticket_types tt join experiences e on e.id = tt.experience_id
          where e.slug = $1`,
        [slug],
      );
      const out: Record<string, number> = {};
      for (const r of res.rows) out[r.key] = r.n;
      return out;
    } finally {
      await pool.end();
    }
  } catch {
    return null;
  }
}

/** Smallest remaining count across ticket types, or null when unknown. */
export function minSpots(spots: Record<string, number> | null): number | null {
  if (!spots) return null;
  const v = Object.values(spots);
  return v.length ? Math.min(...v) : null;
}