import { formatAmount, formatDueDate } from "@/lib/booking/quote";
import type { ScheduleItem } from "@/lib/payments/schedule";

/** Payment plan: every date and amount in the experience's base currency (spec §6.3). */
export default function ScheduleTable({ items, currency }: { items: ScheduleItem[]; currency: string }) {
  return (
    <div className="mt-4">
      <table data-testid="schedule-table" className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-sand text-left text-[10px] uppercase tracking-[0.2em] text-navy/70">
            <th scope="col" className="py-2 font-normal">Date</th>
            <th scope="col" className="py-2 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.seq} className="border-b border-sand/60">
              <td className="py-2">{i.seq === 0 ? "Today" : formatDueDate(i.dueOn)}</td>
              <td className="py-2 text-right tabular-nums">{formatAmount(i.amountMinor, i.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs leading-5 text-navy/70">
        Today&rsquo;s payment is shown in your own currency at checkout. Later payments are charged in {currency}; your
        bank converts.
      </p>
    </div>
  );
}
