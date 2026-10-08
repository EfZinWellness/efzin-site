import Link from "next/link";
import { notFound } from "next/navigation";
import { payRestAction, updateCardAction } from "@/app/account/actions";
import AccountNav from "@/components/account/AccountNav";
import ActionButton from "@/components/account/ActionButton";
import { loadBooking, unpaidMinor } from "@/lib/account/bookings";
import { formatStart, ITEM_LABELS, STATUS_LABELS } from "@/lib/account/format";
import { requirePerson } from "@/lib/auth/session";
import { formatAmount, formatDueDate, OPTION_LABELS } from "@/lib/booking/quote";
import { getSqlClient } from "@/lib/db/client";
import type { PaymentOption } from "@/lib/payments/schedule";
import { WHATSAPP_URL } from "@/lib/site";

export const metadata = { title: "Your booking | My Ef Zin", robots: { index: false } };

const ITEM_TONE: Record<string, string> = { paid: "text-navy/70", failed: "text-oxblood", scheduled: "", cancelled: "text-navy/50" };

export default async function BookingPage({ params, searchParams }: PageProps<"/account/bookings/[id]">) {
  const me = await requirePerson();
  const { id } = await params;
  const q = await searchParams;
  const db = await getSqlClient();
  const b = db ? await loadBooking(db, me.personId, id) : null;
  if (!b) notFound();
  const owed = unpaidMinor(b.schedule);
  const failed = b.schedule.some((i) => i.status === "failed");
  const canPay = b.isBooker && b.status === "deposit_paid" && owed > 0;
  const currency = b.baseCurrency ?? b.schedule[0]?.currency ?? "AED";

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <p className="eyebrow text-center text-navy/70">Your booking</p>
      <h1 className="mt-2 text-center font-serif text-3xl leading-tight">{b.title}</h1>
      <p className="mt-2 text-center text-sm text-navy/80">
        {formatStart(b.startAt, b.timezone)}
        {b.venue ? ` · ${b.venue}` : ""}
      </p>
      <p className="mt-2 text-center text-[10px] uppercase tracking-[0.2em]">{STATUS_LABELS[b.status] ?? b.status}</p>
      <AccountNav current="" />

      {q.paid === "1" ? (
        <p role="status" className="mt-6 border border-sand p-3 text-sm">Thank you. Your payment is being confirmed and will show here shortly.</p>
      ) : null}
      {q.card === "updated" ? (
        <p role="status" className="mt-6 border border-sand p-3 text-sm">Thank you. Your new card will be used for the remaining payments.</p>
      ) : null}

      {!b.myDetailsComplete && b.status !== "cancelled" ? (
        <Link href="/account/health" className="mt-6 flex items-center justify-between gap-3 border border-navy px-4 py-4 text-sm">
          <span>
            Health details &amp; waiver
            <small className="block text-xs text-navy/60">Takes 1 minute</small>
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em]">Complete →</span>
        </Link>
      ) : null}

      {b.isBooker && b.schedule.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-xl">Payments</h2>
          {b.paymentOption ? (
            <p className="mt-1 text-xs text-navy/70">{OPTION_LABELS[b.paymentOption as PaymentOption] ?? b.paymentOption}</p>
          ) : null}
          <table data-testid="account-schedule" className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-sand text-left text-[10px] uppercase tracking-[0.2em] text-navy/70">
                <th scope="col" className="py-2 font-normal">Date</th>
                <th scope="col" className="py-2 text-right font-normal">Amount</th>
                <th scope="col" className="py-2 pl-3 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {b.schedule.map((i) => (
                <tr key={i.seq} className={`border-b border-sand/60 ${ITEM_TONE[i.status] ?? ""}`}>
                  <td className="py-2">{formatDueDate(i.dueOn)}</td>
                  <td className="py-2 text-right tabular-nums">{formatAmount(i.amountMinor, i.currency)}</td>
                  <td className="py-2 pl-3 text-right">{ITEM_LABELS[i.status] ?? i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {owed > 0 ? (
            <p className="mt-3 text-sm">
              Left to pay <strong className="font-medium">{formatAmount(owed, currency)}</strong>
            </p>
          ) : null}
          {failed ? (
            <p className="mt-2 text-xs text-oxblood">A payment did not go through. Pay the rest now or update your card and we&rsquo;ll retry.</p>
          ) : null}
          {canPay ? (
            <div className="mt-5 space-y-3">
              <ActionButton action={payRestAction} fields={{ bookingId: b.id }} label="Pay the rest now" pendingLabel="Opening checkout" solid />
              <ActionButton action={updateCardAction} fields={{ bookingId: b.id }} label="Update card" pendingLabel="Opening checkout" />
              <p className="text-xs leading-5 text-navy/60">
                Remaining payments are charged in {currency} to your saved card on the dates above; your bank converts.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {b.isBooker && b.guests.length > 1 ? (
        <section className="mt-10">
          <h2 className="font-serif text-xl">Who&rsquo;s coming</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {b.guests.map((g, i) => (
              <li key={`${g.name}-${i}`} className="flex items-center justify-between gap-3 border-b border-sand/60 pb-2">
                <span>{g.isBooker ? `${g.name} (you)` : g.name}</span>
                <span className="text-[10px] uppercase tracking-[0.2em] text-navy/70">{g.detailsComplete ? "Details complete" : "Pending"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-10 text-center text-xs leading-5 text-navy/70">
        Need to cancel or transfer your place?{" "}
        <a href={WHATSAPP_URL} className="underline underline-offset-4">Message Tanya</a> and we&rsquo;ll follow your booking&rsquo;s
        cancellation policy.
      </p>
    </div>
  );
}
