import Link from "next/link";
import { ExportLink, NoDatabase, PageTitle, Stat } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { loadRevenue, loadUpcoming } from "@/lib/admin/upcoming";
import { formatStart } from "@/lib/account/format";
import { formatAed } from "@/lib/giftcards/money";

export default async function AdminUpcomingPage() {
  const db = await adminDb();
  if (!db) return <><PageTitle>Upcoming</PageTitle><NoDatabase /></>;
  const [list, revenue] = await Promise.all([loadUpcoming(db, new Date()), loadRevenue(db)]);

  return (
    <>
      <PageTitle sub="Spots, money and missing details for everything still to come.">Upcoming</PageTitle>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Experience revenue (all time)" value={formatAed(revenue.experienceAedMinor)} note="Paid and deposit-paid bookings, gift card and credit included." />
        <Stat label="Gift card sales (not revenue yet)" value={formatAed(revenue.giftSalesAedMinor)} note="Counted when a card is spent." />
      </div>

      {list.length === 0 ? (
        <p className="mt-8 text-sm text-navy/80">Nothing upcoming.</p>
      ) : (
        <table className="stack mt-8">
          <thead>
            <tr><th>Experience</th><th>When</th><th>Sold</th><th>Left</th><th>Revenue (AED)</th><th>Missing details</th></tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td className="lead">
                  <Link href={`/admin/experiences/${e.slug}`} className="underline underline-offset-4">{e.title}</Link>
                  <span className="ml-2 text-xs text-stone">{e.status.replace("_", " ")}</span>
                </td>
                <td data-label="When">{formatStart(e.startAt, e.timezone)}</td>
                <td data-label="Sold">{e.sold} of {e.capacity}</td>
                <td data-label="Left">{e.remaining}</td>
                <td data-label="Revenue">{formatAed(e.revenueAedMinor)}</td>
                <td data-label="Missing details" className={e.missingDetails > 0 ? "text-oxblood" : ""}>{e.missingDetails}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <ExportLink kind="bookings" label="Bookings CSV" />
        <ExportLink kind="people" label="People CSV" />
      </div>
    </>
  );
}
