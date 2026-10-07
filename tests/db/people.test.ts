import { describe, it, expect } from "vitest";
import { freshDb } from "./harness";
import { upsertPersonByEmail } from "../../lib/people/upsert";

describe("upsertPersonByEmail", () => {
  it("is case-insensitive", async () => {
    const db = await freshDb();
    const a = await upsertPersonByEmail(db, { name: "Layla", email: "Layla@Email.com" });
    const b = await upsertPersonByEmail(db, { name: "Layla", email: "layla@email.com" });
    expect(b).toBe(a);
    const r = await db.query<{ email: string }>("select email from people");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].email).toBe("layla@email.com");
  });

  it("does not overwrite non-empty fields but fills blanks", async () => {
    const db = await freshDb();
    const id = await upsertPersonByEmail(db, { name: "Layla", email: "l@e.com", phone: "111" });
    await upsertPersonByEmail(db, { name: "Other", email: "L@e.com", phone: "222", howHeard: "Instagram" });
    const r = await db.query<{ name: string; phone: string; how_heard: string }>(
      "select name, phone, how_heard from people where id = $1",
      [id],
    );
    expect(r.rows[0]).toEqual({ name: "Layla", phone: "111", how_heard: "Instagram" });
  });

  it("fills a blank name later (newsletter sign-ups have none)", async () => {
    const db = await freshDb();
    const id = await upsertPersonByEmail(db, { email: "n@e.com" });
    await upsertPersonByEmail(db, { name: "Noor", email: "n@e.com" });
    const r = await db.query<{ name: string }>("select name from people where id = $1", [id]);
    expect(r.rows[0].name).toBe("Noor");
  });
});