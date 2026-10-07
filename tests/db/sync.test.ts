import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { syncContent } from "../../lib/content/sync";
import { loadExperiences } from "../../lib/content/load";
import type { Experience } from "../../lib/content/schema";

let db: PGlite;
let exps: Experience[];

beforeEach(async () => {
  db = await freshDb();
  exps = await loadExperiences();
});

async function snapshot() {
  const e = await db.query("select * from experiences order by slug");
  const t = await db.query("select * from ticket_types order by experience_id, key");
  return JSON.stringify([e.rows, t.rows]);
}

describe("syncContent", () => {
  it("upserts experiences and tickets, and re-sync is a no-op", async () => {
    const r1 = await syncContent(db, exps);
    expect(r1.errors).toEqual([]);
    expect(r1.upserted.sort()).toEqual(exps.map((e) => e.slug).sort());

    const ex = await db.query<{ n: number }>("select count(*)::int n from experiences");
    const tt = await db.query<{ n: number }>("select count(*)::int n from ticket_types");
    expect(ex.rows[0].n).toBe(3);
    expect(tt.rows[0].n).toBe(3);

    const row = await db.query<Record<string, unknown>>(
      "select * from experiences where slug = '2026-10-04-strong-body-calm-mind'",
    );
    expect(row.rows[0]).toMatchObject({
      type: "event",
      venue: "Rē Social Wellness Club",
      base_currency: "AED",
      policy_template: "standard_event",
      timezone: "Asia/Dubai",
      balance_due_days: 10,
    });
    expect(new Date(row.rows[0].start_at as string).toISOString()).toBe("2026-10-04T08:45:00.000Z");

    const before = await snapshot();
    const r2 = await syncContent(db, exps);
    expect(r2.errors).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it("updates changed fields without creating duplicates", async () => {
    await syncContent(db, exps);
    const changed = exps.map((e) =>
      e.slug === "2026-10-25-flow-and-create"
        ? { ...e, title: "New title", tickets: e.tickets.map((t) => ({ ...t, priceMinor: 1234, capacity: 20 })) }
        : e,
    );
    const r = await syncContent(db, changed);
    expect(r.errors).toEqual([]);
    const t = await db.query<{ price_minor: number; capacity: number }>(
      "select t.price_minor, t.capacity from ticket_types t join experiences e on e.id = t.experience_id where e.slug = '2026-10-25-flow-and-create'",
    );
    expect(t.rows).toEqual([{ price_minor: 1234, capacity: 20 }]);
    const n = await db.query<{ n: number }>("select count(*)::int n from ticket_types");
    expect(n.rows[0].n).toBe(3);
  });

  it("errors and leaves DB unchanged when capacity drops below sold", async () => {
    await syncContent(db, exps);
    const slug = "2026-10-25-flow-and-create";
    const tt = await db.query<{ id: string; experience_id: string }>(
      "select t.id, t.experience_id from ticket_types t join experiences e on e.id = t.experience_id where e.slug = $1",
      [slug],
    );
    const { id: ticketId, experience_id: expId } = tt.rows[0];
    const p = await db.query<{ id: string }>(
      "insert into people (name, email) values ('A', 'a@x.com') returning id",
    );
    const b = await db.query<{ id: string }>(
      "insert into bookings (booker_person_id, experience_id, status) values ($1, $2, 'paid') returning id",
      [p.rows[0].id, expId],
    );
    for (let i = 0; i < 3; i++) {
      await db.query("insert into booking_guests (booking_id, person_id, ticket_type_id) values ($1, $2, $3)", [
        b.rows[0].id,
        p.rows[0].id,
        ticketId,
      ]);
    }
    // a cancelled booking's guests do not count as sold
    const c = await db.query<{ id: string }>(
      "insert into bookings (booker_person_id, experience_id, status) values ($1, $2, 'cancelled') returning id",
      [p.rows[0].id, expId],
    );
    await db.query("insert into booking_guests (booking_id, person_id, ticket_type_id) values ($1, $2, $3)", [
      c.rows[0].id,
      p.rows[0].id,
      ticketId,
    ]);

    const before = await snapshot();
    const lowered = exps.map((e) =>
      e.slug === slug
        ? { ...e, title: "Changed", tickets: e.tickets.map((t) => ({ ...t, capacity: 2 })) }
        : e,
    );
    const r = await syncContent(db, lowered);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(slug);
    expect(r.upserted).not.toContain(slug);
    expect(await snapshot()).toBe(before);

    // equal to sold is fine
    const equal = exps.map((e) =>
      e.slug === slug ? { ...e, tickets: e.tickets.map((t) => ({ ...t, capacity: 3 })) } : e,
    );
    const r2 = await syncContent(db, equal);
    expect(r2.errors).toEqual([]);
  });
});
