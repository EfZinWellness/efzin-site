import Image from "next/image";
import ExperienceGrid from "@/components/ExperienceGrid";
import { loadPast, loadUpcoming } from "@/lib/content/listing";
import { getPricingContext } from "@/lib/pricing/context";

export const metadata = { title: "What's on | Ef Zin" };

export default async function EventsPage() {
  const [list, past, ctx] = await Promise.all([loadUpcoming(), loadPast(), getPricingContext()]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <p className="greek text-center text-sm">εὖ ζῆν</p>
      <h1 className="mt-2 text-center font-serif text-3xl">What&rsquo;s on</h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-navy/80">
        Events in Dubai and retreats further afield. Slow mornings, honest food, time to breathe.
      </p>

      <div className="mt-10">
        <ExperienceGrid experiences={list} visitorCurrency={ctx.visitorCurrency} rates={ctx.rates} />
      </div>

      {past.length > 0 ? (
        <section className="mt-20 border-t border-sand/60 pt-12">
          <h2 className="text-center font-serif text-2xl">Past events</h2>
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {past.map((e) => (
              <li key={e.slug}>
                <div className="relative aspect-square bg-sand/40">
                  <Image src={e.heroImage} alt="" fill sizes="(min-width: 640px) 33vw, 50vw" className="object-cover" />
                </div>
                <p className="mt-2 text-xs text-stone">{e.title}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}