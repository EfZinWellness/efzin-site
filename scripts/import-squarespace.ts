import { readFileSync } from "node:fs";
import { Pool } from "pg";
import type { SqlClient } from "../lib/content/sync";
import { poolConfig } from "../lib/db/pool";
import { importSquarespace, type ProductMap } from "../lib/import/squarespace";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const customers = arg("customers");
  const orders = arg("orders");
  const mapFile = arg("map") ?? "scripts/squarespace-map.json";
  const dryRun = process.argv.includes("--dry-run");
  if (!customers || !orders) {
    console.error(
      "usage: tsx scripts/import-squarespace.ts --customers <file> --orders <file> [--map scripts/squarespace-map.json] [--dry-run]",
    );
    return 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    return 2;
  }

  const map = JSON.parse(readFileSync(mapFile, "utf8")) as ProductMap;
  // One connection, so begin/commit/rollback inside the importer are on the same session.
  const pool = new Pool({ ...poolConfig(url), max: 1 });
  const db: SqlClient = {
    async query<T = unknown>(sql: string, params?: unknown[]) {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[] };
    },
  };

  try {
    const r = await importSquarespace(db, readFileSync(customers, "utf8"), readFileSync(orders, "utf8"), map, { dryRun });
    console.log(`${dryRun ? "[dry run, nothing written] " : ""}new people: ${r.people}, new bookings: ${r.bookings}`);
    console.log(`rows without email: ${r.skippedNoEmail}, invalid order rows: ${r.skippedInvalid}`);
    if (r.unmappedDetail.length) {
      console.log(`UNMAPPED products (add to ${mapFile}; create the past-experience YAML first if needed):`);
      for (const u of r.unmappedDetail) {
        console.log(`  ${u.name} | lines: ${u.count} | first order: ${u.firstOrderDate ?? "?"} | last order: ${u.lastOrderDate ?? "?"}`);
      }
    }
    if (r.skippedStatus.length) console.log(`orders skipped (refunded/cancelled/voided/pending): ${r.skippedStatus.join(", ")}`);
    if (r.unparseableDates) console.log(`lines with a missing, unreadable or timezone-less date: ${r.unparseableDates}`);
    if (r.missingExperiences.length) {
      console.log(`Mapped experiences not in the database (run npm run sync:content):\n  ${r.missingExperiences.join("\n  ")}`);
    }
    if (r.needsAedConversion.length) {
      console.log(`Non-AED bookings stored with amount_aed_minor = 0 (convert by hand):\n  ${r.needsAedConversion.join("\n  ")}`);
    }
    return 0;
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
