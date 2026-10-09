import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshDb } from "./harness";
import { syncContent } from "../../lib/content/sync";
import { loadExperiences } from "../../lib/content/load";
import { importSquarespace } from "../../lib/import/squarespace";

const fx = (n: string) => readFileSync(join(process.cwd(), "tests", "fixtures", n), "utf8");
const MAP = {
  "Strong Body Calm Mind": "2026-10-04-strong-body-calm-mind",
  "Strong Body Calm Mind - Contrast Only": { slug: "2026-10-04-strong-body-calm-mind", ticket: "contrast" },
};

async function setup() {
  const db = await freshDb();
  await syncContent(db, await loadExperiences());
  return db;
}
const run = (db: Awaited<ReturnType<typeof setup>>, opts = {}) =>
  importSquarespace(db, fx("sqsp-customers.csv"), fx("sqsp-orders.csv"), MAP, opts);

describe("importSquarespace", () => {
  it("imports people and bookings, listing unmapped products", async () => {
    const db = await setup();
    const r = await run(db);
    expect(r.people).toBe(3);
    expect(r.bookings).toBe(7);
    expect(r.unmapped).toEqual(["Mystery Workshop"]);
    expect(r.skippedNoEmail).toBe(1);
    expect(r.needsAedConversion).toEqual(["sqsp:1004:1"]);

    const p = await db.query<{ imported_from: string; marketing_consent: boolean; marketing_consent_at: string | null; name: string }>(
      "select * from people where email = 'layla@example.com'",
    );
    expect(p.rows[0].imported_from).toBe("squarespace");
    expect(p.rows[0].marketing_consent).toBe(true);
    expect(p.rows[0].marketing_consent_at).not.toBeNull();
    expect(p.rows[0].name).toBe("Layla Hassan");

    const omar = await db.query<{ marketing_consent: boolean; name: string }>(
      "select marketing_consent, name from people where email = 'omar@example.com'",
    );
    expect(omar.rows[0]).toEqual({ marketing_consent: false, name: "Omar Al Mansoori, Jr." });
  });

  it("repeat customer has own_booking_count 2", async () => {
    const db = await setup();
    await run(db);
    const r = await db.query<{ n: number }>(
      "select own_booking_count(id) as n from people where email = 'layla@example.com'",
    );
    expect(r.rows[0].n).toBe(2);
  });

  it("books paid, imported, with amounts, ticket and check-in at experience start", async () => {
    const db = await setup();
    await run(db);
    const r = await db.query<{
      status: string; imported: boolean; amount_paid_minor: number; amount_aed_minor: number;
      presentment_currency: string; key: string; is_booker: boolean; same_start: boolean;
    }>(
      `select b.status, b.imported, b.amount_paid_minor, b.amount_aed_minor, b.presentment_currency,
              tt.key, g.is_booker, g.checked_in_at = e.start_at as same_start
         from bookings b
         join booking_guests g on g.booking_id = b.id
         join ticket_types tt on tt.id = g.ticket_type_id
         join experiences e on e.id = b.experience_id
        where b.external_ref = $1`,
      ["sqsp:1002:0"],
    );
    expect(r.rows).toEqual([
      { status: "paid", imported: true, amount_paid_minor: 30000, amount_aed_minor: 30000,
        presentment_currency: "AED", key: "contrast", is_booker: true, same_start: true },
    ]);
    const usd = await db.query<{ amount_paid_minor: number; amount_aed_minor: number; presentment_currency: string }>(
      "select amount_paid_minor, amount_aed_minor, presentment_currency from bookings where external_ref = 'sqsp:1004:1'",
    );
    expect(usd.rows[0]).toEqual({ amount_paid_minor: 6500, amount_aed_minor: 0, presentment_currency: "USD" });
  });

  it("carries order-level columns onto continuation rows, keeping refs stable", async () => {
    const db = await setup();
    const r = await run(db);
    const rows = await db.query<{ external_ref: string; email: string; amount_aed_minor: number; day: string }>(
      `select b.external_ref, p.email, b.amount_aed_minor, to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD') as day
         from bookings b join people p on p.id = b.booker_person_id
        where b.external_ref like 'sqsp:1005:%' order by 1`,
    );
    expect(rows.rows).toEqual([
      { external_ref: "sqsp:1005:0", email: "omar@example.com", amount_aed_minor: 25000, day: "2026-09-28" },
      { external_ref: "sqsp:1005:1", email: "omar@example.com", amount_aed_minor: 15000, day: "2026-09-28" },
    ]);
    expect(r.unmappedDetail).toEqual([
      { name: "Mystery Workshop", count: 2, firstOrderDate: "2026-09-25", lastOrderDate: "2026-09-28" },
    ]);
  });

  it("skips refunded orders and reports them; reports dates without a timezone", async () => {
    const db = await setup();
    const r = await run(db);
    expect(r.skippedStatus).toEqual(["1006"]);
    const n = await db.query("select 1 from bookings where external_ref like 'sqsp:1006:%'");
    expect(n.rows).toHaveLength(0);
    expect(r.unparseableDates).toBe(1);
  });

  it("rerun is a no-op", async () => {
    const db = await setup();
    await run(db);
    const again = await run(db);
    expect(again.people).toBe(0);
    expect(again.bookings).toBe(0);
    expect(again.unmapped).toEqual(["Mystery Workshop"]);
    const c = await db.query<{ p: number; b: number; g: number }>(
      "select (select count(*) from people)::int p, (select count(*) from bookings)::int b, (select count(*) from booking_guests)::int g",
    );
    expect(c.rows[0]).toEqual({ p: 3, b: 7, g: 7 });
  });

  it("dry run reports counts but writes nothing", async () => {
    const db = await setup();
    const r = await run(db, { dryRun: true });
    expect(r.people).toBe(3);
    expect(r.bookings).toBe(7);
    const c = await db.query<{ p: number; b: number }>(
      "select (select count(*) from people)::int p, (select count(*) from bookings)::int b",
    );
    expect(c.rows[0]).toEqual({ p: 0, b: 0 });
  });

  it("never overrides a withdrawn marketing consent", async () => {
    const db = await setup();
    await db.query(
      "insert into people (name, email, marketing_consent, marketing_consent_withdrawn_at) values ('Layla', 'layla@example.com', false, now())",
    );
    await run(db);
    const r = await db.query<{ marketing_consent: boolean; imported_from: string | null }>(
      "select marketing_consent, imported_from from people where email = 'layla@example.com'",
    );
    expect(r.rows[0].marketing_consent).toBe(false);
    expect(r.rows[0].imported_from).toBeNull();
  });

  it("reports mapped experiences missing from the database", async () => {
    const db = await freshDb();
    const r = await importSquarespace(db, fx("sqsp-customers.csv"), fx("sqsp-orders.csv"), MAP);
    expect(r.bookings).toBe(0);
    expect(r.missingExperiences).toEqual(["2026-10-04-strong-body-calm-mind"]);
  });
});
