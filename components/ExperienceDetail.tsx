import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Experience } from "@/lib/content/schema";
import { effectiveStatus, loadExperience } from "@/lib/content/load";
import { getSpotsLeft, minSpots } from "@/lib/booking/availability";
import { spotsLeftLabel } from "@/lib/booking/spots";
import { formatRange, formatWhen, interestHref } from "@/lib/format";
import { PILLARS } from "@/lib/pillars";
import { getPricingContext } from "@/lib/pricing/context";
import { ratesSubset } from "@/lib/pricing/visitor";
import { policyCopy } from "@/lib/policy/copy";
import { WHATSAPP_URL } from "@/lib/site";
import PriceTag from "./PriceTag";
import StickyBookBar from "./StickyBookBar";

/** Loads one experience of the given type or 404s. Shared by event and retreat routes. */
export async function loadOr404(slug: string, type: Experience["type"]): Promise<Experience> {
  const e = await loadExperience(slug);
  if (!e || e.type !== type || e.status === "draft") notFound();
  return e;
}

export default async function ExperienceDetail({ experience: e }: { experience: Experience }) {
  const status = effectiveStatus(e, new Date());
  const { visitorCurrency, rates: allRates } = await getPricingContext();
  const rates = ratesSubset(allRates, [e.baseCurrency, visitorCurrency]);
  const spots = await getSpotsLeft(e.slug);
  const spotsText = spotsLeftLabel(minSpots(spots));
  const isRetreat = e.type === "retreat";

  return (
    <article className="pb-24 md:pb-0">
      <header className="relative h-[70svh] min-h-[420px] bg-navy">
        <Image src={e.heroImage} alt="" fill priority sizes="100vw" className="fade-in object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/60 via-transparent to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-10 text-center text-ivory">
          <p className="eyebrow">{e.pillars.map((p) => PILLARS[p].label).join(" · ")}</p>
          <h1 className="mt-3 font-serif text-3xl leading-tight sm:text-4xl">{e.title}</h1>
          <p className="eyebrow mt-4 text-ivory/90">
            {isRetreat ? formatRange(e) : formatWhen(e)} · {e.venue.name}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4">
        <section className="py-12 text-center">
          <p className="greek text-sm">{e.pillars.map((p) => PILLARS[p].greek).join(" · ")}</p>
          <p className="mt-4 font-serif text-xl leading-relaxed">{e.summary}</p>
          {e.story ? <p className="mt-6 whitespace-pre-line text-sm leading-7 text-navy/80">{e.story.trim()}</p> : null}
          {spotsText && status === "on_sale" ? <p className="mt-6 text-sm text-teal">{spotsText}</p> : null}
          {status === "past" ? <p className="mt-6 text-sm text-stone">This experience has taken place.</p> : null}
          {status !== "past" ? (
            <p className="mt-6">
              <Link href={`/gift?for=${e.slug}`} className="eyebrow underline underline-offset-4">
                Give this as a gift
              </Link>
            </p>
          ) : null}
        </section>

        {isRetreat && e.whoItsFor ? (
          <section className="border-t border-sand/60 py-10">
            <h2 className="font-serif text-2xl">Who it&rsquo;s for</h2>
            <p className="mt-3 text-sm leading-7 text-navy/80">{e.whoItsFor}</p>
          </section>
        ) : null}

        {e.schedule.length > 0 ? (
          <section className="border-t border-sand/60 py-10">
            <h2 className="font-serif text-2xl">{isRetreat ? "Daily rhythm" : "Schedule"}</h2>
            <ul className="mt-4 border-t border-sand/60">
              {e.schedule.map((s) => (
                <li key={s.time + s.label} className="flex justify-between gap-4 border-b border-sand/60 py-3 text-sm">
                  <span className="shrink-0 text-stone">{s.time}</span>
                  <span className="text-right">{s.label}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {e.tickets.length > 0 ? (
          <section className="border-t border-sand/60 py-10">
            <h2 className="font-serif text-2xl">Tickets</h2>
            <ul className="mt-4 space-y-3">
              {e.tickets.map((t) => (
                <li key={t.key} className="flex items-center justify-between gap-4 border border-sand/60 bg-white/50 px-4 py-3">
                  <span className="text-sm">
                    {t.name}
                    {t.description ? <small className="block text-xs text-stone">{t.description}</small> : null}
                    {spots && spotsLeftLabel(spots[t.key] ?? null) ? (
                      <small className="block text-xs text-teal">{spotsLeftLabel(spots[t.key] ?? null)}</small>
                    ) : null}
                  </span>
                  <PriceTag
                    baseMinor={t.priceMinor}
                    baseCurrency={e.baseCurrency}
                    visitorCurrency={visitorCurrency}
                    rates={rates}
                    className="text-right text-sm"
                  />
                </li>
              ))}
            </ul>
            {isRetreat && e.depositPct ? (
              <p className="mt-4 text-xs text-stone">
                Secure your place with a {e.depositPct}% deposit, or pay in full.
              </p>
            ) : null}
          </section>
        ) : null}

        {isRetreat && e.accommodation ? (
          <section className="border-t border-sand/60 py-10">
            <h2 className="font-serif text-2xl">Accommodation</h2>
            <p className="mt-3 text-sm leading-7 text-navy/80">{e.accommodation}</p>
          </section>
        ) : null}

        {isRetreat && (e.included.length > 0 || e.notIncluded.length > 0) ? (
          <section className="border-t border-sand/60 py-10">
            {e.included.length > 0 ? (
              <>
                <h2 className="font-serif text-2xl">What&rsquo;s included</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-navy/80">
                  {e.included.map((i) => <li key={i}>{i}</li>)}
                </ul>
              </>
            ) : null}
            {e.notIncluded.length > 0 ? (
              <>
                <h2 className="mt-8 font-serif text-2xl">Not included</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-navy/80">
                  {e.notIncluded.map((i) => <li key={i}>{i}</li>)}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {status === "interest" ? (
          <section className="border-t border-sand/60 py-10 text-center">
            <h2 className="font-serif text-2xl">Dates and details to be confirmed</h2>
            <p className="mt-3 text-sm leading-7 text-navy/80">
              Leave your details and you will be the first to hear when booking opens.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <Link href={interestHref(e.slug)} className="btn btn-solid">Register interest</Link>
            </div>
          </section>
        ) : null}

        {isRetreat ? (
          <section className="border-t border-sand/60 py-10 text-center">
            <p className="text-sm text-navy/80">Questions about the retreat? Talk to Tanya directly.</p>
            <a href={WHATSAPP_URL} className="btn mt-4">Speak to Tanya</a>
          </section>
        ) : null}

        <section className="border-t border-sand/60 py-10">
          <h2 className="font-serif text-2xl">{e.partner ? "Where, and with whom" : "Where"}</h2>
          <p className="mt-3 text-sm">
            {e.venue.name}
            {e.venue.address ? `, ${e.venue.address}` : ""}
          </p>
          {e.partner ? <p className="mt-1 text-xs text-stone">In partnership with {e.partner}</p> : null}
          {e.venue.mapUrl ? (
            <a href={e.venue.mapUrl} className="eyebrow mt-3 inline-block underline underline-offset-4">View map</a>
          ) : null}
        </section>

        <section className="border-t border-sand/60 py-10">
          <h2 className="font-serif text-2xl">Cancellation policy</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-navy/80">
            {policyCopy(e.policy).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        {e.faqs.length > 0 ? (
          <section className="border-t border-sand/60 py-10">
            <h2 className="font-serif text-2xl">Questions</h2>
            <div className="mt-4 divide-y divide-sand/60 border-y border-sand/60">
              {e.faqs.map((f) => (
                <details key={f.q} className="py-3">
                  <summary className="cursor-pointer text-sm">{f.q}</summary>
                  <p className="mt-2 text-sm leading-6 text-navy/80">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        ) : null}

        {e.gallery.length > 0 ? (
          <section className="grid grid-cols-2 gap-2 border-t border-sand/60 py-10">
            {e.gallery.map((src) => (
              <div key={src} className="relative aspect-square">
                <Image src={src} alt="" fill sizes="(min-width: 672px) 336px, 50vw" className="object-cover" />
              </div>
            ))}
          </section>
        ) : null}
      </div>

      {status !== "past" ? (
        <StickyBookBar experience={e} status={status} visitorCurrency={visitorCurrency} rates={rates} />
      ) : null}
    </article>
  );
}