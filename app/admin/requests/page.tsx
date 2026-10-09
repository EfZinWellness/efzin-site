import Link from "next/link";
import { ExportLink, NoDatabase, PageTitle } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { loadRequests } from "@/lib/admin/requests";
import { formatExpiry } from "@/lib/account/format";

const LABELS: Record<string, string> = {
  private: "Private", corporate: "Corporate", coaching: "Coaching", retreat_interest: "Retreat interest", deletion: "Deletion request",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function RequestsPage() {
  const db = await adminDb();
  if (!db) return <><PageTitle>Requests</PageTitle><NoDatabase /></>;
  const requests = await loadRequests(db);

  return (
    <>
      <PageTitle sub="Bespoke, corporate, coaching and retreat-interest enquiries, newest first.">Requests</PageTitle>
      {requests.length === 0 ? (
        <p className="mt-8 text-sm text-navy/80">No requests yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="border border-sand bg-white/60 px-4 py-4">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                <strong className="font-medium">{LABELS[r.type] ?? r.type}</strong>
                <span className="text-xs text-stone">{formatExpiry(r.createdAt)} · {r.status}</span>
              </p>
              <p className="mt-1 text-sm">
                {r.personId ? (
                  <Link href={`/admin/people/${r.personId}`} className="underline underline-offset-4">{r.personName ?? r.personEmail}</Link>
                ) : "Unknown sender"}
                {r.personEmail ? <span className="text-navy/60"> · {r.personEmail}</span> : null}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
                {Object.entries(r.payload).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-xs uppercase tracking-[0.12em] text-stone">{k.replace(/_/g, " ")}</dt>
                    <dd className="break-words">{show(v)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8"><ExportLink kind="requests" label="Requests CSV" /></div>
    </>
  );
}
