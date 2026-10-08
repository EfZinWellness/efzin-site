"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TEST_AUTH_COOKIE } from "@/lib/auth/testSeam";
import { getSupabaseServer } from "@/lib/db/supabase-server";
import { requestOrigin } from "@/lib/requests/origin";
import { createLimiter } from "@/lib/requests/throttle";

export type SignInState = { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string };

const UNAVAILABLE = "Sign-in is not available right now. Please try again later or message us.";
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** 5 sign-in emails per 10 minutes per address (Supabase applies its own limits too). */
const linkLimiter = createLimiter(5, 10 * 60 * 1000);

/** Emails a one-time sign-in link (Supabase OTP). The link lands on /account/auth/callback. */
export async function sendSignInLink(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { kind: "error", message: "Please enter a valid email address." };
  const email = parsed.data;
  if (linkLimiter.blocked(email)) return { kind: "error", message: "Too many links requested. Please try again in a few minutes." };
  linkLimiter.record(email);
  const supabase = await getSupabaseServer();
  if (!supabase) return { kind: "error", message: UNAVAILABLE };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await requestOrigin()}/account/auth/callback` },
  });
  if (error) {
    console.error("[auth] signInWithOtp failed", error.message);
    return { kind: "error", message: "We could not send a link just now. Please try again." };
  }
  return { kind: "sent" };
}

/** Starts Google sign-in and sends the browser to Google. */
export async function signInWithGoogle(): Promise<SignInState> {
  const supabase = await getSupabaseServer();
  if (!supabase) return { kind: "error", message: UNAVAILABLE };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await requestOrigin()}/account/auth/callback` },
  });
  if (error || !data.url) {
    console.error("[auth] Google sign-in failed", error?.message);
    return { kind: "error", message: "Google sign-in is not available right now. Please use the email link." };
  }
  redirect(data.url);
}

const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{8,256}$/;
const OTP_TYPES = new Set(["magiclink", "email"]);

/**
 * Completes an emailed sign-in link (token_hash flow): verified on the server only after the
 * member taps "Sign in" (a same-origin form post), so link scanners and other sites cannot
 * sign anyone in.
 */
export async function confirmSignIn(form: FormData): Promise<void> {
  const tokenHash = form.get("token_hash");
  const type = form.get("type");
  const supabase = await getSupabaseServer();
  if (
    !supabase ||
    typeof tokenHash !== "string" ||
    !TOKEN_HASH_RE.test(tokenHash) ||
    typeof type !== "string" ||
    !OTP_TYPES.has(type)
  ) {
    redirect("/account/signin?error=link");
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "magiclink" | "email" });
  if (error) {
    console.error("[auth] verifyOtp failed", error.message);
    redirect("/account/signin?error=link");
  }
  redirect("/account");
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServer();
  if (supabase) await supabase.auth.signOut();
  if (process.env.NODE_ENV !== "production") (await cookies()).delete(TEST_AUTH_COOKIE);
  redirect("/");
}
