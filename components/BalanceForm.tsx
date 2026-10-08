"use client";

import { useState } from "react";
import { formatAed } from "@/lib/giftcards/money";

type Result =
  | { kind: "idle" | "checking" }
  | { kind: "found"; balanceAedMinor: number; expiresOn: string | null }
  | { kind: "error"; message: string };

const input = "w-full border-b border-navy/40 bg-transparent px-1 py-2 text-sm focus:border-navy focus:outline-none";

/** Public "Check your balance" box: balance and expiry only. */
export default function BalanceForm() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setResult({ kind: "checking" });
    try {
      const res = await fetch("/api/gift/balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        found?: boolean;
        balanceAedMinor?: number;
        expiresOn?: string | null;
        error?: string;
      };
      if (res.ok && data.found && typeof data.balanceAedMinor === "number") {
        return setResult({ kind: "found", balanceAedMinor: data.balanceAedMinor, expiresOn: data.expiresOn ?? null });
      }
      setResult({
        kind: "error",
        message: data.error ?? "We could not find an active gift card with that code. Please check it and try again.",
      });
    } catch {
      setResult({ kind: "error", message: "Sorry, that did not go through. Please try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Check your balance" className="text-left">
      <label htmlFor="balance-code" className="block text-[10px] uppercase tracking-[0.2em] text-navy/80">
        Gift card code
      </label>
      <input
        id="balance-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="EFZG-XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        required
        maxLength={40}
        className={input}
      />
      <button type="submit" disabled={result.kind === "checking"} className="btn mt-5 w-full">
        {result.kind === "checking" ? "Checking" : "Check balance"}
      </button>
      <div role="status" aria-live="polite" className="mt-4 text-sm">
        {result.kind === "found" ? (
          <p>
            Balance <strong>{formatAed(result.balanceAedMinor)}</strong>
            {result.expiresOn ? ` · valid until ${result.expiresOn}` : ""}
          </p>
        ) : null}
        {result.kind === "error" ? <p className="text-oxblood">{result.message}</p> : null}
      </div>
    </form>
  );
}
