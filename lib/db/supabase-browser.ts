"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (cookie storage, so the server sees the session); null when not configured. */
export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}
