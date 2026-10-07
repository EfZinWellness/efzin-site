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