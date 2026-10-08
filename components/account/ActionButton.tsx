"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/account/actions";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** One-button form for a member action (pay the rest, update card, re-send a code, deletion request). */
export default function ActionButton({
  action,
  fields = {},
  label,
  pendingLabel,
  solid = false,
  className = "",
}: {
  action: Action;
  fields?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  solid?: boolean;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, { kind: "idle" } as FormState);
  return (
    <form action={run} className={className}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} className={`btn w-full ${solid ? "btn-solid" : ""}`}>
        {pending ? (pendingLabel ?? "One moment") : label}
      </button>
      {state.kind !== "idle" ? (
        <p role={state.kind === "error" ? "alert" : "status"} className={`mt-2 text-xs leading-5 ${state.kind === "error" ? "text-oxblood" : "text-navy/80"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
