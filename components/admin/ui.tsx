import type { ReactNode } from "react";

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mt-8">
      <h1 className="font-serif text-3xl">{children}</h1>
      {sub ? <p className="mt-1 text-sm text-navy/70">{sub}</p> : null}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="border border-sand bg-white/60 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-stone">{label}</p>
      <p className="mt-1 font-serif text-2xl">{value}</p>
      {note ? <p className="mt-1 text-xs text-navy/60">{note}</p> : null}
    </div>
  );
}

export function ExportLink({ kind, query = "", label = "Download CSV" }: { kind: string; query?: string; label?: string }) {
  return (
    <a href={`/admin/export/${kind}${query}`} className="btn" download>
      {label}
    </a>
  );
}

export function NoDatabase() {
  return <p className="mt-8 text-sm text-navy/80">No database is connected here, so there is nothing to show.</p>;
}
