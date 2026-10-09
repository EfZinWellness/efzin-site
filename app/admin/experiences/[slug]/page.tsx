import Link from "next/link";
import { notFound } from "next/navigation";
import { toggleCheckInForm } from "@/app/admin/actions";
import { ExportLink, NoDatabase, PageTitle } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { healthFlags, loadGuestList } from "@/lib/admin/guests";
import { formatStart } from "@/lib/account/format";

export default async function GuestListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await adminDb();
  if (!db) return <><PageTitle>Guest list</PageTitle><NoDatabase /></>;
  const list = await loadGuestList(db, slug);
  if (!list) notFound();
  const { experience, guests } = list;
  const here = guests.filter((g) => g.checkedIn).length;
  const q = `?experience=${encodeURIComponent(experience.slug)}`;

  return (
    <>
      <PageTitle sub={`${formatStart(experience.startAt, experience.timezone)} · ${here} of ${guests.length} checked in`}>
        {experience.title}
      </PageTitle>
      <p className="mt-2 text-xs text-navy/60">
        Health details are shown to admins only. <Link href="/admin" className="underline underline-offset-4">Back to upcoming</Link>
      </p>

      {guests.length === 0 ? (
        <p className="mt-8 text-sm text-navy/80">No paid guests yet.</p>
      ) : (
        <table className="stack mt-6">
          <thead>
            <tr><th>Guest</th><th>Phone</th><th>Dietary</th><th>Health flags</th><th>Waiver</th><th>Check-in</th></tr>
          </thead>
          <tbody>
            {guests.map((g) => {
              const flags = healthFlags(g.health);
              return (
                <tr key={g.id}>
                  <td className="lead">
                    {g.name}
                    <span className="block text-xs font-normal text-stone">
                      {g.ticket}{g.isBooker ? "" : ` · booked by ${g.bookerName}`}
                    </span>
                    {!g.detailsComplete ? <span className="block text-xs font-normal text-oxblood">Details missing</span> : null}
                  </td>
                  <td data-label="Phone">{g.phone ? <a href={`tel:${g.phone}`} className="underline underline-offset-4">{g.phone}</a> : "-"}</td>
                  <td data-label="Dietary">{g.health?.dietary || "-"}</td>
                  <td data-label="Health" className={flags.length ? "text-oxblood" : ""}>
                    {flags.length ? flags.map((f) => <span key={f} className="block">{f}</span>) : g.health ? "None" : "Not given"}
                  </td>
                  <td data-label="Waiver"><span aria-label={g.waiver ? "Waiver accepted" : "Waiver missing"}>{g.waiver ? "✓" : "✗"}</span></td>
                  <td data-label="">
                    <form action={toggleCheckInForm}>
                      <input type="hidden" name="bookingGuestId" value={g.id} />
                      <button
                        type="submit"
                        aria-pressed={g.checkedIn}
                        className={`btn w-full sm:w-auto ${g.checkedIn ? "btn-solid" : ""}`}
                      >
                        {g.checkedIn ? "Checked in ✓" : "Check in"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <ExportLink kind="guests" query={q} label="Guest list CSV" />
        <ExportLink kind="guests-health" query={q} label="With health details CSV" />
      </div>
    </>
  );
}
