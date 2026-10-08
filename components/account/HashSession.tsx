"use client";

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/db/supabase-browser";

/**
 * Claim links made after payment (Supabase admin magic links) return the session in the URL
 * fragment. This stores it in the auth cookies, removes it from the address bar and opens My Ef Zin.
 */
export default function HashSession() {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) return;
    // Never leave tokens in the address bar or history.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    supabase.auth
      .setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (!error) window.location.replace("/account");
      })
      .catch(() => {});
  }, []);
  return null;
}
