"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BookingStatus } from "@/lib/account/confirmed";
import { formatDayName } from "@/lib/account/format";

const POLL_MS = 2000;
const GIVE_UP_MS = 20_000;

type View = { kind: "waiting" } | { kind: "slow" } | ({ kind: "done" } & Extract<BookingStatus, { status: "confirmed" }>);

const possessive = (name: string) => (name.endsWith("s") ? `${name}’` : `${name}’s`);

/** Polls the booking by Checkout session id (≤ 20 s) until the webhook has confirmed it. */
export default function ConfirmedStatus({ sessionId, fallbackTitle }: { sessionId: string; fallbackTitle: string }) {
  const [view, setView] = useState<View>({ kind: "waiting" });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const poll = async () => {
      try {
        const res = await fetch(`/api/booking-status?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        const data = (await res.json()) as BookingStatus;
        if (stopped) return;
        if (res.ok && data.status === "confirmed") return setView({ kind: "done", ...data });
      } catch {
        // Network blip: keep polling until the time limit.
      }
      if (stopped) return;
      if (Date.now() - started >= GIVE_UP_MS) return setView({ kind: "slow" });
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  if (view.kind !== "done") {
    return (
      <div role="status" aria-live="polite" className="text-center">
        <h1 className="font-serif text-3xl">{view.kind === "slow" ? "Payment received" : "Confirming your booking"}</h1>
        <p className="mt-4 text-sm leading-6 text-navy/80">
          {view.kind === "slow"
            ? `Thank you. We're finishing your booking for ${fallbackTitle}; your confirmation email will arrive shortly.`
            : "This takes a few seconds. Please keep this page open."}
        </p>
        {view.kind === "slow" ? (
          <Link href="/account" className="btn mt-8">Go to My Ef Zin</Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-center">
      <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-navy text-xl">✓</div>
      <h1 className="mt-5 font-serif text-3xl">You’re in, {view.firstName}.</h1>
      <p className="mt-3 text-sm leading-6 text-navy/80">
        {view.venue && view.startAt
          ? `See you at ${view.venue} on ${formatDayName(view.startAt, view.timezone)}. `
          : `See you at ${view.title}. `}
        We&rsquo;ve emailed your confirmation and a calendar invite.
      </p>
      <ul className="mt-8 space-y-3 text-left">
        <li className="flex items-center justify-between gap-3 border border-sand bg-white/60 px-4 py-3">
          <span className="text-sm">
            Health details &amp; waiver
            <small className="block text-xs text-navy/60">{view.healthDone ? "Done, thank you" : "Takes 1 minute"}</small>
          </span>
          {view.healthDone ? (
            <span className="text-[10px] uppercase tracking-[0.2em] text-navy/70">Done</span>
          ) : (
            <Link href="/account/health" className="text-[10px] uppercase tracking-[0.2em] underline underline-offset-4">Complete →</Link>
          )}
        </li>
        {view.pendingGuests.map((g, i) => (
          <li key={`${g}-${i}`} className="flex items-center justify-between gap-3 border border-sand bg-white/60 px-4 py-3">
            <span className="text-sm">
              {possessive(g)} details
              <small className="block text-xs text-navy/60">Link sent to {g}</small>
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-navy/70">Pending</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 bg-sand/30 px-4 py-3 text-sm leading-6">
        Your Ef Zin account is ready. Sign in any time with your email to see your bookings. No password needed.
      </p>
      <Link href="/account" className="btn mt-6">My Ef Zin</Link>
    </div>
  );
}
