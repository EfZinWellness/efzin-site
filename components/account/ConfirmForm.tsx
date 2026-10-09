"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/app/account/actions";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** A member action that needs an explicit "I confirm" tick before the button does anything. */
export default function ConfirmForm({
  action,
  fields = {},
  confirmLabel,
  label,
  pendingLabel = "One moment",
  children,
  testId,
}: {
  action: Action;
  fields?: Record<string, string>;
  confirmLabel: string;
  label: string;
  pendingLabel?: string;
  children?: ReactNode;
  testId?: string;
}) {
  const [state, run, pending] = useActionState(action, { kind: "idle" } as FormState);
  if (state.kind === "ok") {
    return (
      <p role="status" className="text-sm leading-6">
        {state.message}
      </p>
    );
  }
  return (
    <form action={run} className="space-y-3" data-testid={testId}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <label className="flex items-start gap-2 text-xs leading-5">
        <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
        <span>{confirmLabel}</span>
      </label>
      <button type="submit" disabled={pending} className="btn btn-solid w-full">
        {pending ? pendingLabel : label}
      </button>
      {state.kind === "error" ? (
        <p role="alert" className="text-xs leading-5 text-oxblood">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
