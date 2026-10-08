import { createClient } from "@supabase/supabase-js";
import type { SqlClient } from "../content/sync";

/** The part of Supabase Auth's admin API used to create members after payment. */
export interface AuthAdmin {
  /** Creates a confirmed user for the email, or finds the existing one. */
  ensureUser(email: string): Promise<{ userId: string }>;
  /** A one-time sign-in link that lands on `redirectTo`. */
  magicLink(email: string, redirectTo: string): Promise<string>;
}

type AuthErrorLike = { code?: string; status?: number; message?: string };

const alreadyRegistered = (e: AuthErrorLike): boolean =>
  e.code === "email_exists" || /already (been )?registered|already exists/i.test(e.message ?? "");

/** Supabase implementation (service role key: server only). */
export function supabaseAuthAdmin(url: string, serviceRoleKey: string): AuthAdmin {
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
  return {
    async ensureUser(email) {
      const created = await admin.createUser({ email, email_confirm: true });
      if (!created.error && created.data.user) return { userId: created.data.user.id };
      if (created.error && !alreadyRegistered(created.error)) throw created.error;
      // Existing user: generateLink returns the user, which is the cheapest lookup by email.
      const link = await admin.generateLink({ type: "magiclink", email });
      if (link.error) throw link.error;
      return { userId: link.data.user.id };
    },
    async magicLink(email, redirectTo) {
      const { data, error } = await admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
      if (error) throw error;
      return data.properties.action_link;
    },
  };
}

/** From SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; null (provisioning skipped) when either is missing. */
export function getAuthAdmin(): AuthAdmin | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return supabaseAuthAdmin(url, key);
}

export interface ProvisionResult {
  /** person id → claim (sign-in) link */
  links: Map<string, string>;
  errors: string[];
}

/**
 * Makes sure every person has an auth user, links `people.auth_user_id` and creates a claim
 * link for each. Never throws: a failure leaves that person without a link and is reported
 * in `errors` (they can still sign in later with their email).
 */
export async function provisionPeople(
  db: SqlClient,
  auth: AuthAdmin | null,
  people: { personId: string; email: string }[],
  redirectTo: string,
): Promise<ProvisionResult> {
  const result: ProvisionResult = { links: new Map(), errors: [] };
  if (!auth) {
    console.info("[auth] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: member accounts not provisioned");
    return result;
  }
  for (const p of people) {
    try {
      const r = await db.query<{ auth_user_id: string | null }>("select auth_user_id from people where id = $1", [
        p.personId,
      ]);
      if (!r.rows[0]?.auth_user_id) {
        const { userId } = await auth.ensureUser(p.email);
        await db.query("update people set auth_user_id = $2 where id = $1 and auth_user_id is null", [p.personId, userId]);
      }
      result.links.set(p.personId, await auth.magicLink(p.email, redirectTo));
    } catch (err) {
      const msg = `${p.email}: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[auth] provisioning failed", msg);
      result.errors.push(msg);
    }
  }
  return result;
}
