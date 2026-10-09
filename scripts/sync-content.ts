import { Pool } from "pg";
import { loadExperiences } from "../lib/content/load";
import { syncContent, type SqlClient } from "../lib/content/sync";
import { poolConfig } from "../lib/db/pool";

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("sync skipped: DATABASE_URL not set");
    return 0;
  }

  const experiences = await loadExperiences();
  const pool = new Pool({ ...poolConfig(url), max: 1 });
  const db: SqlClient = {
    async query<T = unknown>(sql: string, params?: unknown[]) {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[] };
    },
  };

  try {
    const report = await syncContent(db, experiences);
    for (const s of report.upserted) console.log(`synced ${s}`);
    for (const e of report.errors) console.error(`sync error: ${e}`);
    return report.errors.length ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
