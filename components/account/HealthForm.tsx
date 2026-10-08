"use client";

import { startTransition, useActionState } from "react";
import { saveHealthAction, type FormState } from "@/app/account/actions";
import type { HealthProfile } from "@/lib/account/health";

const label = "block text-[10px] uppercase tracking-[0.2em] text-navy/80";
const area = "mt-1 w-full border border-navy/30 bg-white/60 px-3 py-2 text-sm focus:border-navy focus:outline-none";

function Field({ name, title, hint, value }: { name: string; title: string; hint: string; value: string }) {
  return (
    <div className="mt-6">
      <label htmlFor={`h-${name}`} className={label}>{title}</label>
      <p className="mt-1 text-xs text-navy/60">{hint}</p>
      <textarea id={`h-${name}`} name={name} defaultValue={value} rows={2} maxLength={1000} className={area} />
    </div>
  );
}

/** Health details with explicit consent (required) and the waiver. Only ever for the signed-in person. */
export default function HealthForm({
  profile,
  waiverAcceptedAt,
}: {
  profile: HealthProfile | null;
  waiverAcceptedAt: string | null;
}) {
  const [state, save, pending] = useActionState(saveHealthAction, { kind: "idle" } as FormState);
  const p = profile;
  // Submitted by hand (not `action=`) so React does not reset what was typed when there is an error.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => save(data));
  };
  return (
    <form onSubmit={onSubmit} aria-label="Health details" className="text-left">
      <Field name="conditions" title="Medical conditions" hint="For example asthma, heart or blood pressure conditions, epilepsy." value={p?.conditions ?? ""} />
      <Field name="injuries" title="Injuries" hint="Anything recent or ongoing we should know for movement." value={p?.injuries ?? ""} />
      <Field name="allergies" title="Allergies" hint="Food or other allergies, and how severe." value={p?.allergies ?? ""} />
      <Field name="dietary" title="Dietary needs" hint="Vegetarian, vegan, gluten-free and so on." value={p?.dietary ?? ""} />
      <label className="mt-6 flex items-start gap-3 text-sm">
        <input type="checkbox" name="pregnancy" defaultChecked={p?.pregnancy ?? false} className="mt-1" />
        <span>I am pregnant</span>
      </label>

      <label className="mt-8 flex items-start gap-3 border-t border-sand/60 pt-6 text-sm leading-6">
        <input type="checkbox" name="consent" defaultChecked={Boolean(p?.consentAt)} className="mt-1.5" />
        <span>
          I consent to Ef Zin storing these health details to keep me safe at experiences. Only I and the Ef Zin team can
          see them, and I can ask for them to be deleted at any time.
        </span>
      </label>
      <label className="mt-4 flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" name="waiver" defaultChecked={Boolean(waiverAcceptedAt)} disabled={Boolean(waiverAcceptedAt)} className="mt-1.5" />
        <span>
          {waiverAcceptedAt ? "You have accepted the participation and medical waiver." : "I have read and accept the participation and medical waiver above."}
        </span>
      </label>
      {waiverAcceptedAt ? <input type="hidden" name="waiver" value="on" /> : null}

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
