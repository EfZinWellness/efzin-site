import { describe, it, expect } from "vitest";
import { freshDb } from "./harness";
import { upsertPersonByEmail } from "../../lib/people/upsert";
import { handleNewsletter } from "../../lib/requests/handlers";

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

describe("handleNewsletter consent", () => {
  it("subscribes a new person", async () => {
    const db = await freshDb();
    await handleNewsletter({ email: "s@e.com" }, { db });
    const r = await db.query<{ marketing_consent: boolean; marketing_consent_at: string | null }>(
      "select marketing_consent, marketing_consent_at from people",
    );
    expect(r.rows[0].marketing_consent).toBe(true);
    expect(r.rows[0].marketing_consent_at).not.toBeNull();
  });

  it("does not re-subscribe someone who withdrew consent, but still returns ok", async () => {
    const db = await freshDb();
    await db.query(
      "insert into people (name, email, marketing_consent, marketing_consent_withdrawn_at) values ('W', 'w@e.com', false, now())",
    );
    const res = await handleNewsletter({ email: "W@e.com" }, { db });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const r = await db.query<{ marketing_consent: boolean }>("select marketing_consent from people");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].marketing_consent).toBe(false);
  });
});