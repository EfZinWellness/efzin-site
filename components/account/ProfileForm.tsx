"use client";

import { startTransition, useActionState } from "react";
import { saveProfileAction, type FormState } from "@/app/account/actions";
import type { Profile } from "@/lib/account/profile";

const label = "block text-[10px] uppercase tracking-[0.2em] text-navy/80";
const input = "w-full border-b border-navy/40 bg-transparent px-1 py-2 text-sm focus:border-navy focus:outline-none";

export default function ProfileForm({ profile }: { profile: Profile }) {
  const [state, save, pending] = useActionState(saveProfileAction, { kind: "idle" } as FormState);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => save(data));
  };
  return (
    <form onSubmit={onSubmit} aria-label="Profile" className="text-left">
      <label htmlFor="p-name" className={label}>Name</label>
      <input id="p-name" name="name" defaultValue={profile.name} required maxLength={200} autoComplete="name" className={input} />
      <p className={`${label} mt-6`}>Email</p>
      <p className="py-2 text-sm">{profile.email}</p>
      <p className="text-xs text-navy/60">This is the email you sign in with. Message us to change it.</p>
      <label htmlFor="p-phone" className={`${label} mt-6`}>Phone</label>
      <input id="p-phone" name="phone" type="tel" defaultValue={profile.phone} maxLength={40} autoComplete="tel" className={input} />
      <label className="mt-6 flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" name="marketing" defaultChecked={profile.marketingConsent} className="mt-1.5" />
        <span>Send me the Ef Zin newsletter with new events and retreats.</span>
      </label>
      <button type="submit" disabled={pending} className="btn btn-solid mt-8 w-full">
        {pending ? "Saving" : "Save"}
      </button>
      <div aria-live="polite" className="mt-4 text-sm">
        {state.kind === "error" ? <p role="alert" className="text-oxblood">{state.message}</p> : null}
        {state.kind === "ok" ? <p role="status">{state.message}</p> : null}
      </div>
    </form>
  );
}
