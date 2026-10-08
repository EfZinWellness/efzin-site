import Link from "next/link";
import AccountNav from "@/components/account/AccountNav";
import BookingCard from "@/components/account/BookingCard";
import { loadBookings, pendingGuests, type AccountBooking } from "@/lib/account/bookings";
import { loadCredits, type AccountCredit } from "@/lib/account/credits";
import { formatExpiry } from "@/lib/account/format";
import { loadGiftCards } from "@/lib/account/giftCards";
import { healthComplete } from "@/lib/account/health";
import { loadProfile } from "@/lib/account/profile";
import { requirePerson } from "@/lib/auth/session";
import { getSqlClient } from "@/lib/db/client";
import { formatAed } from "@/lib/giftcards/money";

export const metadata = { title: "My Ef Zin", robots: { index: false } };

const h2 = "mt-10 font-serif text-xl";

async function load(personId: string, email: string) {
  const db = await getSqlClient();
  const now = new Date();
  if (!db) {
    return {
      firstName: email.split("@")[0],
      upcoming: [] as AccountBooking[],
      past: [] as AccountBooking[],
      credits: { totalAedMinor: 0, credits: [] as AccountCredit[] },
      giftCount: 0,
      healthDone: false,
    };
  }
  const [profile, bookings, credits, gifts, healthDone] = await Promise.all([
    loadProfile(db, personId),
    loadBookings(db, personId, now),
    loadCredits(db, personId, now),
    loadGiftCards(db, personId),
    healthComplete(db, personId),
  ]);
  return {
    firstName: (profile?.name ?? email).trim().split(/\s+/)[0],
    ...bookings,
    credits,
    giftCount: gifts.bought.length + gifts.received.length,
    healthDone,
  };
}

export default async function AccountPage() {
  const me = await requirePerson();
  const d = await load(me.personId, me.email);
  const waiting = pendingGuests(d.upcoming);

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <p className="greek text-center text-sm">εὖ ζῆν</p>
      <h1 className="mt-1 text-center font-serif text-3xl">My Ef Zin</h1>
      <p className="mt-2 text-center text-sm text-navy/80">Hello, {d.firstName}</p>
      <AccountNav current="/account" />

      {!d.healthDone ? (
        <Link href="/account/health" className="mt-8 flex items-center justify-between gap-3 border border-navy px-4 py-4">
          <span className="text-sm">
            Health details &amp; waiver
            <small className="block text-xs text-navy/60">Takes 1 minute</small>
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em]">Complete →</span>
        </Link>
      ) : null}

      <h2 className={h2}>Upcoming</h2>
      {d.upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">
          No upcoming bookings yet.{" "}
          <Link href="/events" className="underline underline-offset-4">See what&rsquo;s on</Link>
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {d.upcoming.map((b) => (
            <li key={b.id}><BookingCard booking={b} /></li>
          ))}
        </ul>
      )}

      {waiting.length > 0 ? (
        <>
          <h2 className={h2}>Friends to complete their details</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {waiting.map((g) => (
              <li key={`${g.bookingId}-${g.name}`} className="flex items-center justify-between gap-3 border-b border-sand/60 pb-2">
                <span>
                  {g.name}
                  <small className="block text-xs text-navy/60">{g.title} · link sent by email</small>
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em] text-navy/70">Pending</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2 className={h2}>Credit</h2>
      {d.credits.credits.length === 0 ? (
        <p className="mt-3 text-sm text-navy/80">You have no credit right now.</p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            Balance <strong className="font-medium">{formatAed(d.credits.totalAedMinor)}</strong>
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {d.credits.credits.map((c, i) => (
              <li key={c.code ?? i} className="flex flex-wrap justify-between gap-x-3 border-b border-sand/60 pb-2">
                <span className="font-mono tracking-wider">{c.code ?? "Credit"}</span>
                <span>
                  {formatAed(c.amountAedMinor)} · until {formatExpiry(c.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-navy/60">Enter a code at checkout to use it on any event or retreat.</p>
        </>
      )}

      <h2 className={h2}>Gift cards</h2>
      <p className="mt-3 text-sm text-navy/80">
        {d.giftCount === 0 ? "No gift cards yet. " : `${d.giftCount} gift card${d.giftCount === 1 ? "" : "s"}. `}
        <Link href={d.giftCount === 0 ? "/gift" : "/account/gift-cards"} className="underline underline-offset-4">
          {d.giftCount === 0 ? "Give one" : "See balances"}
        </Link>
      </p>

      {d.past.length > 0 ? (
        <>
          <h2 className={h2}>Past</h2>
          <ul className="mt-4 space-y-3">
            {d.past.map((b) => (
              <li key={b.id}><BookingCard booking={b} /></li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
