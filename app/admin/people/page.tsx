import Link from "next/link";
import { ExportLink, NoDatabase, PageTitle } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { searchPeople } from "@/lib/admin/people";
import { formatAed } from "@/lib/giftcards/money";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const db = await adminDb();
  if (!db) return <><PageTitle>People</PageTitle><NoDatabase /></>;
  const people = await searchPeople(db, q);

  return (
    <>
      <PageTitle sub="Everyone who has booked, been booked, or signed up.">People</PageTitle>
      <form action="/admin/people" method="get" className="mt-6 flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Search by name or email</label>
        <input
          id="q" name="q" defaultValue={q} placeholder="Search by name or email" maxLength={100}
          className="min-w-0 flex-1 border border-sand bg-white/70 px-3 py-3 text-base"
        />
        <button type="submit" className="btn btn-solid">Search</button>
      </form>

      {people.length === 0 ? (
        <p className="mt-8 text-sm text-navy/80">No one found.</p>
      ) : (
        <table className="stack mt-6">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Bookings</th><th>Spent</th></tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td className="lead"><Link href={`/admin/people/${p.id}`} className="underline underline-offset-4">{p.name}</Link></td>
                <td data-label="Email">{p.email}</td>
                <td data-label="Phone">{p.phone ?? "-"}</td>
                <td data-label="Bookings">{p.bookingCount}</td>
                <td data-label="Spent">{formatAed(p.totalSpentAedMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-8"><ExportLink kind="people" label="People CSV" /></div>
    </>
  );
}
