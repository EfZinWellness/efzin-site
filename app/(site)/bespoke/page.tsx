import Image from "next/image";
import Link from "next/link";
import EnquiryForm from "@/components/EnquiryForm";
import { PHOTOS, photo } from "@/lib/images";

export const metadata = {
  title: "Bespoke | Ef Zin",
  description: "Private escapes and corporate wellbeing, designed around you.",
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export default async function BespokePage({ searchParams }: PageProps<"/bespoke">) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  if (one(q.type) === "retreat_interest") {
    const slug = one(q.slug);
    return (
      <section className="mx-auto max-w-xl px-6 py-16">
        <p className="eyebrow text-center text-teal">Retreats</p>
        <h1 className="mt-3 text-center font-serif text-4xl leading-tight">Register your interest</h1>
        <p className="mx-auto mt-4 max-w-md text-center text-sm leading-6 text-navy/80">
          Tell us a little about you and we will write the moment dates and details are confirmed. There is no
          commitment.
        </p>
        <div className="mt-8">
          <EnquiryForm type="retreat_interest" slug={slug && SLUG.test(slug) ? slug : undefined} />
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="mx-auto max-w-2xl px-6 pt-16 text-center">
        <h1 className="font-serif text-4xl leading-tight">Bespoke</h1>
        <p className="mt-4 text-sm leading-7 text-navy/80">
          Wellbeing shaped around you, in Dubai, in Greece or wherever you would like to be. In person, virtual or a
          mix of both.
        </p>
        <nav aria-label="Bespoke paths" className="mt-8 flex flex-wrap justify-center gap-3">
          <a href="#private" className="btn">For you &amp; yours</a>
          <a href="#corporate" className="btn">For your team</a>
        </nav>
      </section>

      <section id="private" className="mx-auto max-w-5xl scroll-mt-4 px-6 py-16">
        <div className="grid items-start gap-10 md:grid-cols-2">
          <div>
            <div className="relative aspect-[4/3] bg-sand/40">
              <Image src={photo(PHOTOS.bespoke, 1000)} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
            </div>
            <h2 className="mt-6 font-serif text-3xl">For you &amp; yours</h2>
            <p className="mt-3 text-sm leading-7 text-navy/80">
              Private escapes for friends, families, couples and celebrations: a sunrise yoga session and long
              brunch in Dubai, or several slow days on a Greek island. We design it, host it and look after every
              detail.
            </p>
          </div>
          <div>
            <h3 className="font-serif text-xl">Tell us what you have in mind</h3>
            <EnquiryForm type="private" />
          </div>
        </div>
      </section>

      <section id="corporate" className="scroll-mt-4 bg-sand/30 px-6 py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-2">
          <div className="relative aspect-[4/3] bg-navy/20">
            <Image src={photo(PHOTOS.corporate, 1000)} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          </div>
          <div>
            <h2 className="font-serif text-3xl">For your team</h2>
            <p className="mt-3 text-sm leading-7 text-navy/80">
              Team days, offsites and recurring programmes that ease stress and bring people together, designed for
              HR and People teams.
            </p>
            <Link href="/bespoke/corporate" className="btn btn-solid mt-6">Plan a team experience</Link>
          </div>
        </div>
      </section>
    </>
  );
}