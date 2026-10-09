import type { SqlClient } from "../content/sync";
import { requireAdmin } from "../auth/admin";
import { getSqlClient } from "../db/client";

/**
 * The only way admin pages reach the database: the admin check (404 otherwise) runs first, so no
 * admin query can execute for anybody else. Null when no database is configured.
 */
export async function adminDb(): Promise<SqlClient | null> {
  await requireAdmin();
  return getSqlClient();
}
