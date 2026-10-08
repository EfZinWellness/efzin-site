import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSqlClient } from "../db/client";
import { getSupabaseServer } from "../db/supabase-server";
import { resolvePerson } from "./resolve";
import { TEST_AUTH_COOKIE, testAuthEmail } from "./testSeam";

export interface CurrentPerson {
  personId: string;
  email: string;
  authUserId: string | null;
}

/** Stand-in id for the e2e seam when there is no database (pages then show empty states). */
export const NO_DB_PERSON_ID = "00000000-0000-0000-0000-000000000000";

async function fromTestSeam(): Promise<CurrentPerson | null | undefined> {
  // Literal NODE_ENV check so production builds drop this branch entirely.
  if (process.env.NODE_ENV === "production") return undefined;
  const store = await cookies();
  const email = testAuthEmail(process.env, store.has(TEST_AUTH_COOKIE));
  if (!email) return undefined;
  const db = await getSqlClient();
  if (!db) return { personId: NO_DB_PERSON_ID, email, authUserId: null };
  const r = await db.query<{ id: string; email: string }>("select id, email from people where lower(email) = $1", [email]);
  return r.rows[0] ? { personId: r.rows[0].id, email: r.rows[0].email, authUserId: null } : null;
}

/**
 * The signed-in member: the Supabase session from the auth cookies (verified with Supabase),
 * resolved to a person by auth_user_id, falling back to a confirmed email (which is then linked).
 * Null when nobody is signed in or Supabase / the database is not configured.
 */
export async function getCurrentPerson(): Promise<CurrentPerson | null> {
  const seam = await fromTestSeam();
  if (seam !== undefined) return seam;

  const supabase = await getSupabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const user = data.user;
  const db = await getSqlClient();
  if (!db) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  const person = await resolvePerson(db, {
    id: user.id,
    email: user.email,
    emailConfirmed: Boolean(user.email_confirmed_at),
    name,
  });
  return person ? { ...person, authUserId: user.id } : null;
}

/** For member pages and actions: the signed-in person, or a redirect to sign-in. */
export async function requirePerson(): Promise<CurrentPerson> {
  const me = await getCurrentPerson();
  if (!me) redirect("/account/signin");
  return me;
}
