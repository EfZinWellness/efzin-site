"use client";

import { useMemo, useState } from "react";
import ScheduleTable from "./ScheduleTable";
import CodeField, { type AppliedCode } from "./CodeField";
import {
  OPTION_LABELS,
  bookingTotal,
  formatAmount,
  formatDueDate,
  paymentOptionsFor,
  scheduleFor,
  type QuoteExperience,
} from "@/lib/booking/quote";
import { allocateDiscounts } from "@/lib/payments/allocate";
import type { PaymentOption } from "@/lib/payments/schedule";
import type { Experience } from "@/lib/content/schema";

export type BookingFormExperience = QuoteExperience & Pick<Experience, "slug" | "title">;

const input = "w-full border-b border-navy/40 bg-transparent px-1 py-2 text-sm focus:border-navy focus:outline-none";
const label = "mt-5 block text-[10px] uppercase tracking-[0.2em] text-navy/80";
const section = "mt-10 text-[10px] uppercase tracking-[0.2em] text-navy/60";

type Guest = { name: string; email: string; phone: string };
type Outcome = { kind: "idle" | "sending" | "confirmed" } | { kind: "error"; message: string };

const ERRORS: Record<string, string> = {
  sold_out: "Just sold out. Please choose fewer spots or join the waitlist.",
  gift_insufficient: "That gift card no longer has enough value. Please remove it and try again.",
  gift_invalid: "That gift card code is not recognised.",
  gift_expired: "That gift card has expired.",
  credit_invalid: "That credit code is not recognised or has been used.",
};

function Field(p: { id: string; text: string; type?: string; required?: boolean; value: string; onChange: (v: string) => void; autoComplete?: string }) {
  return (
    <div>
      <label htmlFor={p.id} className={label}>{p.text}</label>
      <input id={p.id} type={p.type ?? "text"} required={p.required} autoComplete={p.autoComplete} value={p.value}
        onChange={(e) => p.onChange(e.target.value)} className={input} />
    </div>
  );
}

export default function BookingForm({ experience: e, nowIso, policy }: { experience: BookingFormExperience; nowIso: string; policy: string[] }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const options = useMemo(() => paymentOptionsFor(e, now), [e, now]);
  const [qty, setQty] = useState<Record<string, number>>(() => ({ [e.tickets[0]?.key ?? ""]: 1 }));
  const [booker, setBooker] = useState({ name: "", email: "", phone: "", howHeard: "" });
  const [guests, setGuests] = useState<Guest[]>([]);
  const [option, setOption] = useState<PaymentOption>("full");
  const [codes, setCodes] = useState<AppliedCode[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const lines = e.tickets.map((t) => ({ ticketKey: t.key, qty: qty[t.key] ?? 0 })).filter((l) => l.qty > 0);
  // Booker takes the first ticket; guests take the rest in order.
  const seats = lines.flatMap((l) => Array<string>(l.qty).fill(l.ticketKey));
  const total = bookingTotal(e, lines);
  const schedule = scheduleFor(e, total, option, now);
  const gift = codes.find((c) => c.kind === "gift");
  const credit = codes.find((c) => c.kind === "credit");
  const allocation = allocateDiscounts({
    schedule,
    giftAvailableBaseMinor: gift?.availableBase ?? 0,
    creditAvailableBaseMinor: credit?.availableBase ?? 0,
  });
  const dueToday = allocation.schedule[0]?.amountMinor ?? 0;
  const covered = allocation.schedule.every((i) => i.amountMinor === 0);

  function changeQty(key: string, delta: number) {
    const next = { ...qty, [key]: Math.max(0, (qty[key] ?? 0) + delta) };
    const count = Object.values(next).reduce((s, n) => s + n, 0);
    if (count < 1 || count > 21) return;
    setQty(next);
    setGuests((g) => Array.from({ length: count - 1 }, (_, i) => g[i] ?? { name: "", email: "", phone: "" }));
  }

  const ticketName = (key: string) => e.tickets.find((t) => t.key === key)?.name ?? key;

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const website = String(new FormData(ev.currentTarget).get("website") ?? "");
    setOutcome({ kind: "sending" });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: e.slug,
          lines,
          booker,
          guests: guests.map((g, i) => ({ ...g, ticketKey: seats[i + 1] })),
          paymentOption: option,
          giftCode: gift?.code,
          creditCode: credit?.code,
          policyAccepted: true,
          scheduleConsent: option !== "full" ? true : undefined,
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { kind?: string; url?: string; error?: string; errors?: string[]; message?: string };
      if (res.ok && data.kind === "redirect" && data.url) {
        window.location.assign(data.url);
        return;
      }
      if (res.ok && data.kind === "confirmed") return setOutcome({ kind: "confirmed" });
      const message = data.errors?.join(" ") ?? (data.error && ERRORS[data.error]) ?? data.message ?? "Sorry, that did not go through. Please try again.";
      setOutcome({ kind: "error", message });
    } catch {
      setOutcome({ kind: "error", message: "Sorry, that did not go through. Please check your connection and try again." });
    }
  }

  if (outcome.kind === "confirmed") {
    return (
      <div role="status" className="mt-10 border border-sand/70 p-6 text-center">
        <p className="font-serif text-2xl">You&rsquo;re in{booker.name ? `, ${booker.name.split(" ")[0]}` : ""}.</p>
        <p className="mt-3 text-sm text-navy/80">Your gift card or credit covered everything. We&rsquo;ve emailed your confirmation.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-label="Booking form" className="text-left">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <h2 className="mt-8 font-serif text-xl">Choose your experience</h2>
      {e.tickets.map((t) => {
        const n = qty[t.key] ?? 0;
        return (
          <div key={t.key} className={`mt-3 flex items-center justify-between gap-3 border bg-white/60 px-4 py-3 ${n > 0 ? "border-navy" : "border-sand"}`}>
            <div className="min-w-0 text-sm">
              {t.name}
              <span className="block text-xs text-navy/60">{t.description ?? formatAmount(t.priceMinor, e.baseCurrency)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <button type="button" aria-label={`Remove one ${t.name}`} onClick={() => changeQty(t.key, -1)} className="h-8 w-8 border border-navy">−</button>
              <span aria-live="polite" className="w-4 text-center tabular-nums">{n}</span>
              <button type="button" aria-label={`Add one ${t.name}`} onClick={() => changeQty(t.key, 1)} className="h-8 w-8 border border-navy">+</button>
            </div>
          </div>
        );
      })}

      <p className={section}>Your details{seats[0] && seats.length > 1 ? ` · ${ticketName(seats[0])}` : ""}</p>
      <Field id="b-name" text="Your name" required autoComplete="name" value={booker.name} onChange={(v) => setBooker({ ...booker, name: v })} />
      <Field id="b-email" text="Email" type="email" required autoComplete="email" value={booker.email} onChange={(v) => setBooker({ ...booker, email: v })} />
      <Field id="b-phone" text="Phone" type="tel" required autoComplete="tel" value={booker.phone} onChange={(v) => setBooker({ ...booker, phone: v })} />
      <Field id="b-heard" text="How did you hear about us? (optional)" value={booker.howHeard} onChange={(v) => setBooker({ ...booker, howHeard: v })} />

      {guests.map((g, i) => {
        const n = i + 2;
        const set = (patch: Partial<Guest>) => setGuests(guests.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={n}>
            <p className={section}>Guest {n} · {ticketName(seats[i + 1])}</p>
            <Field id={`g${n}-name`} text={`Guest ${n} name`} required value={g.name} onChange={(v) => set({ name: v })} />
            <Field id={`g${n}-email`} text={`Guest ${n} email`} type="email" required value={g.email} onChange={(v) => set({ email: v })} />
            <Field id={`g${n}-phone`} text={`Guest ${n} phone (optional)`} type="tel" value={g.phone} onChange={(v) => set({ phone: v })} />
            <p className="mt-2 text-xs text-navy/60">They&rsquo;ll get a link to add their health details and waiver.</p>
          </div>
        );
      })}

      {options.length > 1 ? (
        <div className="mt-10">
          <p id="pay-legend" className="text-[10px] uppercase tracking-[0.2em] text-navy/60">How would you like to pay?</p>
          <div role="radiogroup" aria-labelledby="pay-legend" className="mt-3 space-y-2">
            {options.map((o) => {
              const s = scheduleFor(e, total, o, now);
              const hint = o === "full" ? `${formatAmount(total, e.baseCurrency)} today`
                : o === "deposit_balance" ? `${formatAmount(s[0].amountMinor, e.baseCurrency)} today, the rest on ${formatDueDate(s[1].dueOn)}`
                : `${formatAmount(s[0].amountMinor, e.baseCurrency)} today, then ${s.length - 1} monthly payments`;
              return (
                <label key={o} className={`flex cursor-pointer gap-3 border bg-white/60 px-4 py-3 text-sm ${option === o ? "border-navy" : "border-sand"}`}>
                  <input type="radio" name="paymentOption" value={o} checked={option === o} onChange={() => setOption(o)} className="mt-1" />
                  <span>{OPTION_LABELS[o]}<span className="block text-xs text-navy/60">{hint}</span></span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {option !== "full" ? (
        <>
          <ScheduleTable items={allocation.schedule} currency={e.baseCurrency} />
          <label className="mt-4 flex gap-3 text-sm">
            <input type="checkbox" required className="mt-1" />
            <span>Ef Zin will charge this card on these dates</span>
          </label>
        </>
      ) : null}

      <CodeField slug={e.slug} applied={codes} onChange={setCodes} currency={e.baseCurrency} />

      <div className="mt-8 flex items-baseline justify-between border-t border-sand pt-4 text-sm">
        <span>Total</span>
        <span className="tabular-nums">{formatAmount(total, e.baseCurrency)}</span>
      </div>
      {dueToday !== total ? (
        <div className="mt-1 flex items-baseline justify-between text-sm">
          <span>Due today</span>
          <span className="tabular-nums">{formatAmount(dueToday, e.baseCurrency)}</span>
        </div>
      ) : null}

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer">Cancellation policy</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-navy/80">
          {policy.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </details>
      <label className="mt-4 flex gap-3 text-sm">
        <input type="checkbox" required className="mt-1" />
        <span>I accept the cancellation policy</span>
      </label>

      {outcome.kind === "error" ? <p role="alert" className="mt-4 text-sm text-oxblood">{outcome.message}</p> : null}
      <button type="submit" disabled={outcome.kind === "sending"}
        className="mt-6 w-full border border-navy bg-navy px-6 py-3 text-xs uppercase tracking-[0.2em] text-ivory disabled:opacity-60">
        {outcome.kind === "sending" ? "One moment…" : covered ? "Confirm booking" : "Continue to payment"}
      </button>
      <p className="mt-3 text-center text-[11px] text-navy/60">Secure payment by Stripe, in your own currency.</p>
    </form>
  );
}
