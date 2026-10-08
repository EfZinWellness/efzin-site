import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Public Supabase URL and anon key (safe in the browser); null when not configured. */
export function supabasePublicConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * A per-request Supabase client bound to the auth cookies (sign-in, session, sign-out only:
 * data is read through the service-role pool, scoped to the signed-in person).
 * Null when Supabase is not configured.
 */
export async function getSupabaseServer() {
  const cfg = supabasePublicConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; the proxy refreshes the session.
        }
      },
    },
  });
}
