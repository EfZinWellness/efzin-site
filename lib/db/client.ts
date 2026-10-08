import type { SqlClient } from "../content/sync";
import { getPool } from "./pool";

/** A SqlClient over the shared pool, or null when no database is configured (preview without a DB). */
export async function getSqlClient(): Promise<SqlClient | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const pool = await getPool(url);
  return {
    async query<T = unknown>(sql: string, params?: unknown[]) {
      const r = await pool.query(sql, params as unknown[] | undefined);
      return { rows: r.rows as T[] };
    },
  };
}

/**
 * Runs `fn` with one dedicated connection, so `begin`/`commit` issued through the
 * SqlClient apply to the same session. Returns null when no database is configured.
 */
export async function withDbClient<T>(fn: (db: SqlClient) => Promise<T>): Promise<T | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const conn = await (await getPool(url)).connect();
  try {
    return await fn({
      async query<R = unknown>(sql: string, params?: unknown[]) {
        const r = await conn.query(sql, params as unknown[] | undefined);
        return { rows: r.rows as R[] };
      },
    });
  } finally {
    conn.release();
  }
}