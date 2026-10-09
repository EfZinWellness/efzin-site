import Link from "next/link";
import { ExportLink, NoDatabase, PageTitle, Stat } from "@/components/admin/ui";
import { adminDb } from "@/lib/admin/access";
import {
  dubaiToday,
  loadPaymentsDue,
  loadUnrefunded,
  type AttentionReason,
  type PaymentItem,
  type UnrefundedPayment,
} from "@/lib/admin/payments";
import { formatExpiry } from "@/lib/account/format";

const REASONS: Record<AttentionReason, string> = {
  failed: "Payment failed",
  repeated_failures: "Failed 2 or more times",
  not_attempted: "Past due, never attempted",
};

const UNREFUNDED: Record<UnrefundedPayment["kind"], string> = {
  inactive_invoice: "Instalment charged after the booking was cancelled",
  pay_rest_excess: "Overpaid with “Pay the rest now”",
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
  const [p, unrefunded] = await Promise.all([loadPaymentsDue(db, dubaiToday(new Date())), loadUnrefunded(db)]);

  return (
    <>
      <PageTitle sub="Instalments due in the next 30 days, payments to chase, and what is still to collect.">Payments due</PageTitle>

      {unrefunded.length > 0 ? (
        <>
          <h2 className="mt-8 font-serif text-xl text-oxblood">Refunds still to make</h2>
          <p className="mt-2 text-sm text-navy/80">
            Money the site should have given back automatically but could not yet. It retries every morning; refund by hand in
            Stripe anything that stays here.
          </p>
          <table className="stack mt-4">
            <thead>
              <tr><th>Seen</th><th>Why</th><th>Experience</th><th>Amount</th><th>Stripe</th><th>Booker</th><th>Contact</th></tr>
            </thead>
            <tbody>
              {unrefunded.map((u) => (
                <tr key={u.ref}>
                  <td className="lead">{day(u.seenAt.slice(0, 10))}</td>
                  <td data-label="Why">{UNREFUNDED[u.kind]}</td>
                  <td data-label="Experience">
                    {u.slug ? <Link href={`/admin/experiences/${u.slug}`} className="underline underline-offset-4">{u.title}</Link> : "Unknown booking"}
                  </td>
                  <td data-label="Amount">{u.currency ? money(u.amountMinor, u.currency) : u.amountMinor}</td>
                  <td data-label="Stripe">{u.ref}</td>
                  <td data-label="Booker">{u.bookerName ?? ""}</td>
                  <td data-label="Contact">
                    {u.bookerEmail ? <a href={`mailto:${u.bookerEmail}`} className="underline underline-offset-4">{u.bookerEmail}</a> : null}
                    {u.bookerPhone ? <span className="block"><a href={`tel:${u.bookerPhone}`} className="underline underline-offset-4">{u.bookerPhone}</a></span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

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
