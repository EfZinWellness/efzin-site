import Link from "next/link";
import { ExportLink, NoDatabase, PageTitle, Stat } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import { dubaiToday, loadPaymentsDue, type AttentionReason, type PaymentItem } from "@/lib/admin/payments";
import { formatExpiry } from "@/lib/account/format";

const REASONS: Record<AttentionReason, string> = {
  failed: "Payment failed",
  repeated_failures: "Failed 2 or more times",
  not_attempted: "Past due, never attempted",
};

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);

const day = (ymd: string) => formatExpiry(`${ymd}T12:00:00Z`);

function Table({ items, chase }: { items: PaymentItem[]; chase: boolean }) {
  return (
    <table className="stack mt-4">
      <thead>
        <tr>
          <th>Due</th><th>Experience</th><th>Amount</th>
          {chase ? <><th>Why</th><th>Attempts</th></> : null}
          <th>Booker</th><th>Contact</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td className="lead">{day(i.dueOn)}</td>
            <td data-label="Experience"><Link href={`/admin/experiences/${i.slug}`} className="underline underline-offset-4">{i.title}</Link></td>
            <td data-label="Amount">{money(i.amountMinor, i.currency)}</td>
            {chase ? (
              <>
                <td data-label="Why" className="text-oxblood">{i.reasons.map((r) => REASONS[r]).join("; ")}</td>
                <td data-label="Attempts">{i.attempts}</td>
              </>
            ) : null}
            <td data-label="Booker">{i.bookerName}</td>
            <td data-label="Contact">
              <a href={`mailto:${i.bookerEmail}`} className="underline underline-offset-4">{i.bookerEmail}</a>
              {i.bookerPhone ? <span className="block"><a href={`tel:${i.bookerPhone}`} className="underline underline-offset-4">{i.bookerPhone}</a></span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PaymentsDuePage() {
  const db = await adminDb();
  if (!db) return <><PageTitle>Payments due</PageTitle><NoDatabase /></>;
  const p = await loadPaymentsDue(db, dubaiToday(new Date()));

  return (
    <>
      <PageTitle sub="Instalments due in the next 30 days, payments to chase, and what is still to collect.">Payments due</PageTitle>

      <h2 className="mt-8 font-serif text-xl">To chase</h2>
      {p.attention.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">Nothing to chase.</p>
      ) : (
        <Table items={p.attention} chase />
      )}

      <h2 className="mt-10 font-serif text-xl">Due in the next 30 days</h2>
      {p.dueSoon.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">Nothing due in the next 30 days.</p>
      ) : (
        <Table items={p.dueSoon} chase={false} />
      )}

      <h2 className="mt-10 font-serif text-xl">Still to collect</h2>
      {p.toCollect.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">No outstanding instalments.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {p.toCollect.map((t) => (
            <Stat key={`${t.slug}${t.currency}`} label={t.title} value={money(t.totalMinor, t.currency)} />
          ))}
        </div>
      )}
      <div className="mt-8"><ExportLink kind="payments-due" label="Payments CSV" /></div>
    </>
  );
}
