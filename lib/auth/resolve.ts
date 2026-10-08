import type { SqlClient } from "../content/sync";

export interface AuthUserInfo {
  id: string;
  email: string | null | undefined;
  /** True when Supabase has confirmed the user owns the email (email link or verified Google account). */
  emailConfirmed: boolean;
  /** The sign-in provider (Supabase `app_metadata.provider`, else from the identities list). */
  provider?: string | null;
  /** Display name from the identity provider, used only when a new person is created. */
  name?: string | null;
}

/** Providers that prove ownership of the email: passwordless email links and Google. */
export const LINKABLE_PROVIDERS: ReadonlySet<string> = new Set(["email", "google"]);

const nameFromEmail = (email: string) => email.split("@")[0] || "Member";

/**
 * The person for a signed-in Supabase user: linked by people.auth_user_id; otherwise, only for a
 * confirmed email from a linkable provider (email link or Google), matched by email and linked
 * (only if the person is not linked to another auth user), or created. Returns null when the
 * user cannot safely be tied to a person.
 */
export async function resolvePerson(db: SqlClient, user: AuthUserInfo): Promise<{ personId: string; email: string } | null> {
  const linked = await db.query<{ id: string; email: string }>("select id, email from people where auth_user_id = $1", [
    user.id,
  ]);
  if (linked.rows[0]) return { personId: linked.rows[0].id, email: linked.rows[0].email };

  const email = user.email?.trim().toLowerCase();
  if (!email || !user.emailConfirmed || !user.provider || !LINKABLE_PROVIDERS.has(user.provider)) return null;

  const byEmail = await db.query<{ id: string; email: string; auth_user_id: string | null }>(
    "select id, email, auth_user_id from people where lower(email) = $1",
    [email],
  );
  const found = byEmail.rows[0];
  if (found) {
    if (found.auth_user_id && found.auth_user_id !== user.id) return null;
    const set = await db.query<{ id: string }>(
      "update people set auth_user_id = $2 where id = $1 and (auth_user_id is null or auth_user_id = $2) returning id",
      [found.id, user.id],
    );
    return set.rows[0] ? { personId: found.id, email: found.email } : null;
  }

  const created = await db.query<{ id: string; email: string }>(
    `insert into people (name, email, auth_user_id) values ($1, $2, $3)
     on conflict ((lower(email))) do nothing returning id, email`,
    [user.name?.trim() || nameFromEmail(email), email, user.id],
  );
  return created.rows[0] ? { personId: created.rows[0].id, email: created.rows[0].email } : null;
}
