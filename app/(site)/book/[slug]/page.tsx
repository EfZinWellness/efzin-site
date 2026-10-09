import Link from "next/link";
import { notFound } from "next/navigation";
import BookingForm from "@/components/BookingForm";
import CancelledCheckout from "@/components/CancelledCheckout";
import { effectiveStatus, loadExperience } from "@/lib/content/load";
import { getSqlClient } from "@/lib/db/client";
import { detailHref, formatRange, formatWhen } from "@/lib/format";
import { policyCopy } from "@/lib/policy/copy";
import { releaseCancelled } from "./actions";

/** Spots free across the experience's tickets (0 without a database). */
async function spotsLeft(slug: string): Promise<number> {
  const db = await getSqlClient();
  if (!db) return 0;
  const r = await db.query<{ n: number | null }>(
    `select max(available_spots(t.id))::int as n from ticket_types t join experiences e on e.id = t.experience_id where e.slug = $1`,
    [slug],
  );
  return r.rows[0]?.n ?? 0;
}

async function load(slug: string) {
  const e = await loadExperience(slug);
  if (!e || e.status === "draft") notFound();
  return e;
}

export async function generateMetadata({ params }: PageProps<"/book/[slug]">) {
  const e = await load((await params).slug);
  return { title: `Book ${e.title} | Ef Zin`, robots: { index: false } };
}

export default async function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  const e = await load((await params).slug);
  const cancelled = (await searchParams).cancelled;
  const cancelledId = typeof cancelled === "string" ? cancelled : null;
  const now = new Date();
  const when = `${e.type === "retreat" ? formatRange(e) : formatWhen(e)} · ${e.venue.name}`;

  const status = effectiveStatus(e, now);
  // Sold-out content is bookable again once a cancellation frees a spot (the waitlist is emailed this link).
  const soldOutWithSpace = status === "sold_out" && (await spotsLeft(e.slug)) > 0;
  if (status !== "on_sale" && !soldOutWithSpace) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-serif text-3xl">{e.title}</h1>
        <p className="mt-6 text-sm text-navy/80">{status === "sold_out" ? "Sold out" : "Not currently available"}</p>
        {status === "sold_out" ? (
          <Link href={`/waitlist/${e.slug}`} className="mt-4 block text-xs underline underline-offset-4">
            Join the waitlist
          </Link>
        ) : null}
        <Link href={detailHref(e)} className="mt-8 inline-block border border-navy px-6 py-3 text-xs uppercase tracking-[0.2em]">
          Back to {e.title}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <h1 className="font-serif text-3xl leading-tight">{e.title}</h1>
      <p className="eyebrow mt-2 text-navy/70">{when}</p>
      {cancelledId && <CancelledCheckout pendingId={cancelledId} release={releaseCancelled} />}
      <BookingForm
        experience={{
          slug: e.slug,
          title: e.title,
          startsAt: e.startsAt,
          timezone: e.timezone,
          paymentOptions: e.paymentOptions,
          maxInstalments: e.maxInstalments,
          depositPct: e.depositPct,
          baseCurrency: e.baseCurrency,
          tickets: e.tickets,
        }}
        nowIso={now.toISOString()}
        policy={policyCopy(e.policy)}
      />
    </div>
  );
}
