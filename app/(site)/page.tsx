import Image from "next/image";
import Link from "next/link";
import ExperienceCard from "@/components/ExperienceCard";
import NewsletterForm from "@/components/NewsletterForm";
import { loadUpcoming } from "@/lib/content/listing";
import { getSpotsLeftMany, minSpots } from "@/lib/booking/availability";
import { INSTAGRAM_GRID, PHOTOS, photo } from "@/lib/images";
import { PILLARS, type Pillar } from "@/lib/pillars";
import { getPricingContext } from "@/lib/pricing/context";
import { ratesSubset } from "@/lib/pricing/visitor";
import { INSTAGRAM_URL, TAGLINE } from "@/lib/site";
import type { Experience } from "@/lib/content/schema";

const PILLAR_PHOTO: Record<Pillar, string> = {
  move: PHOTOS.move,
  nourish: PHOTOS.nourish,
  thrive: PHOTOS.thrive,
};

export default async function Home() {
  const [list, ctx] = await Promise.all([loadUpcoming(), getPricingContext()]);
  const events = list.filter((e) => e.type === "event").slice(0, 3);
  const retreat = list.find((e) => e.type === "retreat");

  const spots = await getSpotsLeftMany(list.map((e) => e.slug));

  const card = async (e: Experience, priority = false) => (
    <ExperienceCard
      experience={e}
      visitorCurrency={ctx.visitorCurrency}
      rates={ratesSubset(ctx.rates, [e.baseCurrency, ctx.visitorCurrency])}
      minSpots={minSpots(spots?.[e.slug])}
      priority={priority}
    />
  );

  return (
    <>
      <section className="relative h-[85svh] min-h-[480px] bg-navy" aria-label="Welcome">
        <Image src={photo(PHOTOS.hero, 2500)} alt="" fill priority sizes="100vw" className="fade-in object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/55 via-transparent to-transparent" />
        <div className="absolute inset-x-0 bottom-14 px-4 text-center text-ivory">
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{TAGLINE}</h1>
          <p className="eyebrow mt-4">Events · Retreats · Bespoke</p>
        </div>
      </section>

      <section data-testid="section-intro" className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="greek text-base">εὖ ζῆν</p>
        <p className="mt-4 font-serif text-2xl leading-relaxed">
          To live well, in the old Greek sense: unhurried, nourished, and fully present. We bring that wisdom into
          modern days.
        </p>
      </section>

      <section data-testid="section-pillars" className="mx-auto max-w-5xl px-4 pb-20">
        <ul className="grid gap-10 sm:grid-cols-3">
          {(Object.keys(PILLARS) as Pillar[]).map((p) => (
            <li key={p}>
              <div className="relative aspect-[4/5] bg-sand/40">
                <Image src={photo(PILLAR_PHOTO[p], 1000)} alt="" fill sizes="(min-width: 640px) 33vw, 100vw" className="object-cover" />
              </div>
              <h2 className="mt-4 font-serif text-xl">{PILLARS[p].label}</h2>
              <p className="greek text-sm">{PILLARS[p].greek}</p>
              <p className="mt-2 text-sm leading-6 text-navy/80">{PILLARS[p].blurb}</p>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="section-upcoming" className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="text-center font-serif text-3xl">Upcoming experiences</h2>
        <ul className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {await Promise.all(events.map(async (e) => <li key={e.slug}>{await card(e)}</li>))}
        </ul>
        <p className="mt-10 text-center">
          <Link href="/events" className="btn">See everything on</Link>
        </p>
      </section>

      <section data-testid="section-retreat" className="bg-olive px-4 py-20 text-ivory">
        <div className="mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-2">
          <div className="relative aspect-[4/5] bg-navy/30">
            <Image
              src={retreat?.heroImage ?? photo(PHOTOS.retreatCard, 1500)}
              alt=""
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="text-center md:text-left">
            <p className="eyebrow text-sand">Featured retreat</p>
            <h2 className="mt-3 font-serif text-3xl leading-tight">{retreat?.title ?? "Retreats in Greece"}</h2>
            <p className="mt-4 text-sm leading-7 text-ivory/85">
              {retreat?.summary ?? "Several days to slow down, move, eat well and breathe."}
            </p>
            <Link href={retreat ? `/retreats/${retreat.slug}` : "/retreats"} className="btn mt-8">
              Discover the retreat
            </Link>
          </div>
        </div>
      </section>

      <section data-testid="section-bespoke" className="mx-auto max-w-5xl px-4 py-20">
        <h2 className="text-center font-serif text-3xl">Bespoke</h2>
        <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-navy/80">
          Wellbeing shaped around you, in Dubai or abroad.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {[
            { t: "For you & yours", d: "Private escapes for friends and family.", img: PHOTOS.bespoke, href: "/bespoke#private" },
            { t: "For your team", d: "Corporate days, offsites and recurring programmes.", img: PHOTOS.corporate, href: "/bespoke#corporate" },
          ].map((b) => (
            <Link key={b.t} href={b.href} className="group relative block aspect-[4/3] overflow-hidden bg-navy">
              <Image src={photo(b.img, 1000)} alt="" fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-navy/65 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 p-5 text-ivory">
                <span className="block font-serif text-2xl">{b.t}</span>
                <span className="mt-1 block text-xs">{b.d}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section data-testid="section-founder" className="bg-sand/30 px-4 py-20">
        <div className="mx-auto grid max-w-4xl items-center gap-8 md:grid-cols-2">
          <div className="relative aspect-[4/5]">
            <Image src={photo(PHOTOS.founder, 1000)} alt="Tanya, founder of Ef Zin" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          </div>
          <div className="text-center md:text-left">
            <p className="eyebrow text-teal">Founder</p>
            <h2 className="mt-3 font-serif text-3xl">Hello, I&rsquo;m Tanya</h2>
            <p className="mt-4 text-sm leading-7 text-navy/80">
              Ef Zin began with a simple belief: the oldest ways of caring for body and mind still have the most to
              teach us. I create gatherings that make space for them, gently and without fuss.
            </p>
            <Link href="/about" className="btn mt-8">Read my story</Link>
          </div>
        </div>
      </section>

      <section data-testid="section-instagram" className="px-4 py-20">
        <h2 className="text-center font-serif text-3xl">Instagram</h2>
        <p className="eyebrow mt-3 text-center">@efzinwellness</p>
        <ul className="mx-auto mt-8 grid max-w-4xl grid-cols-3 gap-1.5">
          {INSTAGRAM_GRID.map((id) => (
            <li key={id}>
              <a href={INSTAGRAM_URL} className="relative block aspect-square bg-sand/40" aria-label="Ef Zin on Instagram">
                <Image src={photo(id, 600)} alt="" fill sizes="(min-width: 896px) 290px, 33vw" className="object-cover" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="section-newsletter" className="bg-navy px-4 py-16 text-center text-ivory">
        <h2 className="font-serif text-2xl">Stay close</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ivory/80">New dates, recipes and the occasional letter. Nothing more.</p>
        <NewsletterForm />
      </section>
    </>
  );
}