import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { resolvePerson } from "../../lib/auth/resolve";
import { testAuthEmail } from "../../lib/auth/testSeam";
import { claimLink } from "../../lib/auth/provision";

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
    expect(await resolvePerson(db, { id: uid, email: "Layla@Email.com", emailConfirmed: true, provider: "email" })).toEqual({
      personId: pid,
      email: "layla@email.com",
    });
    const r = await db.query<{ auth_user_id: string }>("select auth_user_id from people where id = $1", [pid]);
    expect(r.rows[0].auth_user_id).toBe(uid);
  });

  it("links by email only for the passwordless email or Google providers", async () => {
    const pid = await person("Layla", "layla@email.com");
    const github = await authUser("layla@email.com");
    expect(
      await resolvePerson(db, { id: github, email: "layla@email.com", emailConfirmed: true, provider: "github" }),
    ).toBeNull();
    expect(await resolvePerson(db, { id: github, email: "layla@email.com", emailConfirmed: true })).toBeNull();
    const r = await db.query<{ auth_user_id: string | null }>("select auth_user_id from people where id = $1", [pid]);
    expect(r.rows[0].auth_user_id).toBeNull();
    // Nor does an unsupported provider get a new person created.
    const other = await authUser("new@email.com");
    expect(await resolvePerson(db, { id: other, email: "new@email.com", emailConfirmed: true, provider: "phone" })).toBeNull();
    expect((await db.query("select * from people where email = 'new@email.com'")).rows).toEqual([]);

    const google = await authUser("layla2@email.com");
    expect(
      (await resolvePerson(db, { id: google, email: "layla@email.com", emailConfirmed: true, provider: "google" }))?.personId,
    ).toBe(pid);
  });

  it("returns null when the link update loses a race to another auth user", async () => {
    const pid = await person("Layla", "layla@email.com");
    const uid = await authUser("layla@email.com");
    const racer = await authUser("racer@email.com");
    // Simulate the row being linked between the read and the update.
    const db2 = {
      query: async <T,>(sql: string, params?: unknown[]) => {
        if (sql.startsWith("update people set auth_user_id")) {
          await db.query("update people set auth_user_id = $2 where id = $1", [pid, racer]);
        }
        return (await db.query<T>(sql, params)) as { rows: T[] };
      },
    };
    expect(await resolvePerson(db2, { id: uid, email: "layla@email.com", emailConfirmed: true, provider: "email" })).toBeNull();
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
    expect(await resolvePerson(db, { id: uid, email: "layla@email.com", emailConfirmed: true, provider: "email" })).toBeNull();
  });

  it("creates a person for a confirmed new member", async () => {
    const uid = await authUser("new@email.com");
    const r = await resolvePerson(db, { id: uid, email: "New@Email.com", emailConfirmed: true, provider: "google", name: "Nadia" });
    expect(r?.email).toBe("new@email.com");
    const p = await db.query<{ name: string; auth_user_id: string }>("select name, auth_user_id from people");
    expect(p.rows).toEqual([{ name: "Nadia", auth_user_id: uid }]);
  });
});

describe("claimLink (token-hash sign-in links)", () => {
  it("points at /account/auth/confirm on the site with the hashed token, never a fragment token", () => {
    const url = claimLink("https://www.efzinwellness.com/account", "abc123hash");
    expect(url).toBe("https://www.efzinwellness.com/account/auth/confirm?token_hash=abc123hash&type=magiclink");
    expect(url).not.toContain("#");
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
