import Link from "next/link";
import { unpaidMinor, type AccountBooking } from "@/lib/account/bookings";
import { formatStart, STATUS_LABELS } from "@/lib/account/format";
import { formatAmount, formatDueDate } from "@/lib/booking/quote";

/** A booking in the list: when, status, and the next payment or a failed one for the booker. */
export default function BookingCard({ booking: b }: { booking: AccountBooking }) {
  const failed = b.schedule.some((i) => i.status === "failed");
  const next = b.schedule.find((i) => i.status === "scheduled");
  const owed = unpaidMinor(b.schedule);
  return (
    <Link
      href={b.choiceToken ? `/account/cancellation/${b.choiceToken}` : `/account/bookings/${b.id}`}
      className="block border border-sand bg-white/60 px-4 py-4 hover:border-navy"
    >
      <p className="font-serif text-lg leading-snug">{b.title}</p>
      <p className="mt-1 text-xs text-navy/70">
        {formatStart(b.startAt, b.timezone)}
        {b.venue ? ` · ${b.venue}` : ""}
      </p>
      <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-navy/80">
        {STATUS_LABELS[b.status] ?? b.status}
        {b.isBooker ? "" : " · You're a guest"}
      </p>
      {b.choiceToken ? (
        <p className="mt-2 text-xs text-oxblood underline underline-offset-4">Cancelled by Ef Zin: choose refund or credit</p>
      ) : failed ? (
        <p className="mt-2 text-xs text-oxblood">A payment failed. Open the booking to pay or update your card.</p>
      ) : next && b.status === "deposit_paid" ? (
        <p className="mt-2 text-xs text-navy/80">
          Next payment {formatAmount(next.amountMinor, next.currency)} on {formatDueDate(next.dueOn)}
          {owed > next.amountMinor ? ` · ${formatAmount(owed, next.currency)} left in total` : ""}
        </p>
      ) : null}
    </Link>
  );
}
