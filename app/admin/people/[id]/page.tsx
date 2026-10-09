import Link from "next/link";
import { notFound } from "next/navigation";
import { NoDatabase, PageTitle, Stat } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { healthFlags } from "@/lib/admin/guests";
import { loadPersonDetail } from "@/lib/admin/people";
import { formatExpiry } from "@/lib/account/format";
import { formatAed } from "@/lib/giftcards/money";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await adminDb();
  if (!db) return <><PageTitle>Person</PageTitle><NoDatabase /></>;
  const p = await loadPersonDetail(db, id);
  if (!p) notFound();
  const flags = healthFlags(p.health);

  return (
    <>
      <PageTitle sub={<><a href={`mailto:${p.email}`} className="underline underline-offset-4">{p.email}</a>{p.phone ? ` · ${p.phone}` : ""}</>}>
        {p.name}
      </PageTitle>
      <p className="mt-2 text-xs"><Link href="/admin/people" className="underline underline-offset-4 text-navy/70">All people</Link></p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total spent" value={formatAed(p.totalSpentAedMinor)} />
        <Stat label="Own bookings counted" value={p.ownBookingCount} note="Checked in, or imported." />
        <Stat label="Birthday" value={p.birthday ? formatExpiry(`${p.birthday}T12:00:00Z`) : "-"} />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="eyebrow text-stone">How they heard</dt><dd className="mt-1">{p.howHeard ?? "-"}</dd></div>
        <div><dt className="eyebrow text-stone">Marketing consent</dt><dd className="mt-1">{p.marketingConsent ? "Yes" : "No"}</dd></div>
        <div className="sm:col-span-2"><dt className="eyebrow text-stone">Notes</dt><dd className="mt-1 whitespace-pre-wrap">{p.notes ?? "-"}</dd></div>
        <div className="sm:col-span-2">
          <dt className="eyebrow text-stone">Health (admin only)</dt>
          <dd className="mt-1">
            {p.health ? (flags.length ? flags.join("; ") : "Nothing flagged") : "Not given"}
            {p.health?.dietary ? ` · Dietary: ${p.health.dietary}` : ""}
          </dd>
        </div>
      </dl>

      <h2 className="mt-10 font-serif text-xl">History</h2>
      {p.bookings.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">No bookings yet.</p>
      ) : (
        <table className="stack mt-4">
          <thead>
            <tr><th>Experience</th><th>Booked</th><th>Role</th><th>Status</th><th>Paid (AED)</th><th>Attended</th></tr>
          </thead>
          <tbody>
            {p.bookings.map((b) => (
              <tr key={b.id}>
                <td className="lead"><Link href={`/admin/experiences/${b.slug}`} className="underline underline-offset-4">{b.title}</Link></td>
                <td data-label="Booked">{formatExpiry(b.createdAt)}{b.imported ? " (imported)" : ""}</td>
                <td data-label="Role">{b.role === "booker" ? "Booker" : "Guest"}</td>
                <td data-label="Status">{b.status.replace("_", " ")}</td>
                <td data-label="Paid">{b.role === "booker" ? formatAed(b.amountAedMinor) : "-"}</td>
                <td data-label="Attended">{b.checkedIn ? "✓" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
