import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { resolvePerson } from "../../lib/auth/resolve";
import { testAuthEmail } from "../../lib/auth/testSeam";

let db: PGlite;

const authUser = async (email: string) =>
  (await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email])).rows[0].id;
const person = async (name: string, email: string, authUserId: string | null = null) =>
  (
    await db.query<{ id: string }>("insert into people (name, email, auth_user_id) values ($1, $2, $3) returning id", [
      name,
      email,
      authUserId,
    ])
  ).rows[0].id;

beforeEach(async () => {
  db = await freshDb();
});

describe("resolvePerson", () => {
  it("finds the person linked to the auth user", async () => {
    const uid = await authUser("layla@email.com");
    const pid = await person("Layla", "layla@email.com", uid);
    expect(await resolvePerson(db, { id: uid, email: "layla@email.com", emailConfirmed: true })).toEqual({
      personId: pid,
      email: "layla@email.com",
    });
  });

  it("falls back to a confirmed email (case-insensitive) and links the auth user", async () => {
    const uid = await authUser("Layla@Email.com");
    const pid = await person("Layla", "layla@email.com");
    expect(await resolvePerson(db, { id: uid, email: "Layla@Email.com", emailConfirmed: true })).toEqual({
      personId: pid,
      email: "layla@email.com",
    });
    const r = await db.query<{ auth_user_id: string }>("select auth_user_id from people where id = $1", [pid]);
    expect(r.rows[0].auth_user_id).toBe(uid);
  });

  it("does not match by email when the email is not confirmed", async () => {
    const uid = await authUser("layla@email.com");
    await person("Layla", "layla@email.com");
    expect(await resolvePerson(db, { id: uid, email: "layla@email.com", emailConfirmed: false })).toBeNull();
  });

  it("never takes over a person linked to a different auth user", async () => {
    const other = await authUser("old@email.com");
    await person("Layla", "layla@email.com", other);
    const uid = await authUser("layla@email.com");
    expect(await resolvePerson(db, { id: uid, email: "layla@email.com", emailConfirmed: true })).toBeNull();
  });

  it("creates a person for a confirmed new member", async () => {
    const uid = await authUser("new@email.com");
    const r = await resolvePerson(db, { id: uid, email: "New@Email.com", emailConfirmed: true, name: "Nadia" });
    expect(r?.email).toBe("new@email.com");
    const p = await db.query<{ name: string; auth_user_id: string }>("select name, auth_user_id from people");
    expect(p.rows).toEqual([{ name: "Nadia", auth_user_id: uid }]);
  });
});

describe("testAuthEmail (e2e seam)", () => {
  const env = (over: Record<string, string | undefined>) => ({ ...over }) as NodeJS.ProcessEnv;

  it("is never active in production, even with the variable and the cookie", () => {
    expect(testAuthEmail(env({ NODE_ENV: "production", EFZIN_TEST_AUTH_EMAIL: "e2e@example.com" }), true)).toBeNull();
  });

  it("is active outside production only with both the variable and the cookie", () => {
    expect(testAuthEmail(env({ NODE_ENV: "development", EFZIN_TEST_AUTH_EMAIL: "e2e@example.com" }), true)).toBe(
      "e2e@example.com",
    );
    expect(testAuthEmail(env({ NODE_ENV: "development", EFZIN_TEST_AUTH_EMAIL: "e2e@example.com" }), false)).toBeNull();
    expect(testAuthEmail(env({ NODE_ENV: "development" }), true)).toBeNull();
    expect(testAuthEmail(env({ NODE_ENV: "test", EFZIN_TEST_AUTH_EMAIL: "" }), true)).toBeNull();
  });
});
