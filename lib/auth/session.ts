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

/**
 * none: nobody is signed in. person: signed in as a known person. no_profile: there is a
 * Supabase session but it cannot be tied to a person (shown a "contact us" message, not looped).
 */
export type SessionState =
  | { kind: "none" }
  | { kind: "person"; person: CurrentPerson }
  | { kind: "no_profile"; email: string | null };

/** Stand-in id for the e2e seam when there is no database (pages then show empty states). */
export const NO_DB_PERSON_ID = "00000000-0000-0000-0000-000000000000";

async function fromTestSeam(): Promise<SessionState | undefined> {
  // Literal NODE_ENV check so production builds drop this branch entirely.
  if (process.env.NODE_ENV === "production") return undefined;
  const store = await cookies();
  const email = testAuthEmail(process.env, store.has(TEST_AUTH_COOKIE));
  if (!email) return undefined;
  const db = await getSqlClient();
  if (!db) return { kind: "person", person: { personId: NO_DB_PERSON_ID, email, authUserId: null } };
  const r = await db.query<{ id: string; email: string }>("select id, email from people where lower(email) = $1", [email]);
  return r.rows[0]
    ? { kind: "person", person: { personId: r.rows[0].id, email: r.rows[0].email, authUserId: null } }
    : { kind: "no_profile", email };
}

/** Provider of the sign-in: app_metadata.provider, else the first identity's provider. */
function providerOf(user: { app_metadata?: Record<string, unknown>; identities?: { provider: string }[] | null }) {
  const p = user.app_metadata?.provider;
  if (typeof p === "string") return p;
  return user.identities?.[0]?.provider ?? null;
}

/**
 * The Supabase session from the auth cookies (verified with Supabase), resolved to a person by
 * auth_user_id, falling back to a confirmed email from the email-link or Google provider.
 */
export async function getSessionState(): Promise<SessionState> {
  const seam = await fromTestSeam();
  if (seam !== undefined) return seam;

  const supabase = await getSupabaseServer();
  if (!supabase) return { kind: "none" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "none" };
  const user = data.user;
  const db = await getSqlClient();
  if (!db) return { kind: "no_profile", email: user.email ?? null };
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  const person = await resolvePerson(db, {
    id: user.id,
    email: user.email,
    emailConfirmed: Boolean(user.email_confirmed_at),
    provider: providerOf(user),
    name,
  });
  return person
    ? { kind: "person", person: { ...person, authUserId: user.id } }
    : { kind: "no_profile", email: user.email ?? null };
}

/** The signed-in member, or null (nobody signed in, or no matching profile). */
export async function getCurrentPerson(): Promise<CurrentPerson | null> {
  const s = await getSessionState();
  return s.kind === "person" ? s.person : null;
}

/** For member pages and actions: the signed-in person, or a redirect to sign-in (which explains a missing profile). */
export async function requirePerson(): Promise<CurrentPerson> {
  const me = await getCurrentPerson();
  if (!me) redirect("/account/signin");
  return me;
}
