"use client";

import { useState } from "react";
import { formatAmount } from "@/lib/booking/quote";

export type AppliedCode = { code: string; kind: "gift" | "credit"; availableBase: number };

/** One gift card and one credit per booking, each checked with /api/codes/check. */
export default function CodeField({
  slug,
  currency,
  applied,
  onChange,
}: {
  slug: string;
  currency: string;
  applied: AppliedCode[];
  onChange: (codes: AppliedCode[]) => void;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply() {
    const code = value.trim();
    if (!code) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/codes/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, slug }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        valid?: boolean;
        kind?: "gift" | "credit";
        availableBase?: number;
        error?: string;
      };
      if (data.valid && data.kind && typeof data.availableBase === "number") {
        const next = { code, kind: data.kind, availableBase: data.availableBase };
        onChange([...applied.filter((c) => c.kind !== next.kind), next]);
        setValue("");
      } else {
        setMessage(data.error ?? "That code is not recognised, has been used or has expired.");
      }
    } catch {
      setMessage("Could not check the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10">
      <label htmlFor="code" className="text-[10px] uppercase tracking-[0.2em] text-navy/60">
        Have a code?
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
          placeholder="Gift card or credit code"
          autoCapitalize="characters"
          className="min-w-0 flex-1 border-b border-navy/40 bg-transparent px-1 py-2 text-sm uppercase focus:border-navy focus:outline-none"
        />
        <button type="button" onClick={apply} disabled={busy} className="border border-navy px-4 text-xs uppercase tracking-[0.2em]">
          Apply
        </button>
      </div>
      {message ? <p role="alert" className="mt-2 text-xs text-oxblood">{message}</p> : null}
      {applied.map((c) => (
        <p key={c.kind} className="mt-2 flex items-center justify-between text-xs">
          <span>
            {c.kind === "gift" ? "Gift card" : "Credit"} {c.code.toUpperCase()}: up to {formatAmount(c.availableBase, currency)}
          </span>
          <button type="button" className="underline underline-offset-4" onClick={() => onChange(applied.filter((x) => x !== c))}>
            Remove
          </button>
        </p>
      ))}
    </div>
  );
}
