import Link from "next/link";
import { notFound } from "next/navigation";
import { effectiveStatus, loadExperience } from "@/lib/content/load";
import { bookHref, detailHref, formatRange, formatWhen } from "@/lib/format";

async function load(slug: string) {
  const e = await loadExperience(slug);
  if (!e || e.status === "draft") notFound();
  return e;
}

export async function generateMetadata({ params }: PageProps<"/waitlist/[slug]">) {
  const e = await load((await params).slug);
  return { title: `Join the waitlist: ${e.title} | Ef Zin`, robots: { index: false } };
}

const RESULTS: Record<string, string> = {
  joined: "You're on the waitlist. We'll email you as soon as a place opens up; places go to whoever books first.",
  already: "You're already on the waitlist for this one. We'll email you if a place opens up.",
  available: "Good news: there are places available right now.",
  closed: "This experience isn't taking bookings any more.",
  error: "Something went wrong. Please check your details and try again.",
};

export default async function WaitlistPage({ params, searchParams }: PageProps<"/waitlist/[slug]">) {
  const e = await load((await params).slug);
  const q = await searchParams;
  const result = typeof q.result === "string" && q.result in RESULTS ? q.result : null;
  const status = effectiveStatus(e, new Date());
  const when = `${e.type === "retreat" ? formatRange(e) : formatWhen(e)} · ${e.venue.name}`;
  const done = result === "joined" || result === "already";

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <p className="eyebrow text-navy/70">Waitlist</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{e.title}</h1>
      <p className="eyebrow mt-2 text-navy/70">{when}</p>

      {result ? (
        <p role={result === "error" ? "alert" : "status"} className="mt-6 border border-sand p-3 text-sm">
          {RESULTS[result]}
          {result === "available" ? (
            <>
              {" "}
              <Link href={bookHref(e.slug)} className="underline underline-offset-4">Book now</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {status === "past" ? (
        <p className="mt-6 text-sm">This experience has taken place.</p>
      ) : done ? null : (
        <form method="post" action="/api/waitlist" className="mt-8 space-y-4" data-testid="waitlist-form">
          <p className="text-sm leading-6 text-navy/80">
            Leave your name and email and we&rsquo;ll let you know the moment a place opens up.
          </p>
          <input type="hidden" name="slug" value={e.slug} />
          {e.tickets.length > 1 ? (
            <label className="block text-xs">
              Ticket
              <select name="ticket" className="mt-1 w-full border border-sand bg-transparent px-2 py-2 text-sm">
                {e.tickets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs">
            Name
            <input name="name" required maxLength={120} autoComplete="name" className="mt-1 w-full border border-sand bg-transparent px-2 py-2 text-sm" />
          </label>
          <label className="block text-xs">
            Email
            <input name="email" type="email" required maxLength={254} autoComplete="email" className="mt-1 w-full border border-sand bg-transparent px-2 py-2 text-sm" />
          </label>
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          </div>
          <button type="submit" className="btn btn-solid w-full">Join the waitlist</button>
          <p className="text-xs text-navy/60">We only use your email to tell you about a place on this experience.</p>
        </form>
      )}

      <Link href={detailHref(e)} className="mt-8 inline-block text-xs underline underline-offset-4">
        Back to {e.title}
      </Link>
    </div>
  );
}
