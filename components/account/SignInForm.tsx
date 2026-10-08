"use client";

import { useActionState } from "react";
import { sendSignInLink, signInWithGoogle, type SignInState } from "@/app/account/auth-actions";

const input = "w-full border-b border-navy/40 bg-transparent px-1 py-2 text-sm focus:border-navy focus:outline-none";
const idle: SignInState = { kind: "idle" };

/** Email link (primary) and Google. No passwords. */
export default function SignInForm() {
  const [linkState, sendLink, sending] = useActionState(sendSignInLink, idle);
  const [googleState, google, redirecting] = useActionState(signInWithGoogle, idle);

  if (linkState.kind === "sent") {
    return (
      <div role="status" className="border border-sand/70 p-6 text-center">
        <p className="font-serif text-2xl">Check your email</p>
        <p className="mt-3 text-sm leading-6 text-navy/80">
          We&rsquo;ve sent you a sign-in link. Open it on this device to see your bookings.
        </p>
      </div>
    );
  }

  const error = linkState.kind === "error" ? linkState.message : googleState.kind === "error" ? googleState.message : null;

  return (
    <div className="text-left">
      <form action={sendLink} aria-label="Sign in with email">
        <label htmlFor="signin-email" className="block text-[10px] uppercase tracking-[0.2em] text-navy/80">
          Email
        </label>
        <input id="signin-email" name="email" type="email" autoComplete="email" required maxLength={254} className={input} />
        <button type="submit" disabled={sending} className="btn btn-solid mt-5 w-full">
          {sending ? "Sending" : "Email me a sign-in link"}
        </button>
      </form>
      <p className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-navy/60">
        <span className="h-px flex-1 bg-sand" aria-hidden="true" />or<span className="h-px flex-1 bg-sand" aria-hidden="true" />
      </p>
      <form action={google}>
        <button type="submit" disabled={redirecting} className="btn w-full">
          Continue with Google
        </button>
      </form>
      <div role="alert" aria-live="polite" className="mt-4 text-sm text-oxblood">
        {error}
      </div>
    </div>
  );
}
