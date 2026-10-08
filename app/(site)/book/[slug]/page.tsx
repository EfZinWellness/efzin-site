import Link from "next/link";
import { notFound } from "next/navigation";
import BookingForm from "@/components/BookingForm";
import { effectiveStatus, loadExperience } from "@/lib/content/load";
import { detailHref, formatRange, formatWhen } from "@/lib/format";
import { policyCopy } from "@/lib/policy/copy";

async function load(slug: string) {
  const e = await loadExperience(slug);
  if (!e || e.status === "draft") notFound();
  return e;
}

export async function generateMetadata({ params }: PageProps<"/book/[slug]">) {
  const e = await load((await params).slug);
  return { title: `Book ${e.title} | Ef Zin`, robots: { index: false } };
}

export default async function BookPage({ params }: PageProps<"/book/[slug]">) {
  const e = await load((await params).slug);
  const now = new Date();
  const when = `${e.type === "retreat" ? formatRange(e) : formatWhen(e)} · ${e.venue.name}`;

  if (effectiveStatus(e, now) !== "on_sale") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-serif text-3xl">{e.title}</h1>
        <p className="mt-6 text-sm text-navy/80">Not currently available</p>
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
