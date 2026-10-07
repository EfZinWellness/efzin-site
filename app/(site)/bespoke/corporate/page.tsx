import Image from "next/image";
import EnquiryForm from "@/components/EnquiryForm";
import { PHOTOS, photo } from "@/lib/images";

export const metadata = {
  title: "Corporate wellbeing | Ef Zin",
  description: "Team days, offsites and recurring wellbeing programmes in Dubai and abroad.",
};

const FORMATS = [
  ["Team day", "A half or full day in Dubai: movement, a nourishing lunch and time to reset."],
  ["Offsite", "Several days away, in Greece or elsewhere, to slow down and reconnect."],
  ["Recurring", "Weekly or monthly sessions in your office, online or hybrid."],
] as const;

export default function CorporatePage() {
  return (
    <>
      <section className="mx-auto max-w-2xl px-6 pt-16 text-center">
        <p className="eyebrow text-teal">Bespoke</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">For your team</h1>
        <p className="mt-4 text-sm leading-7 text-navy/80">
          Wellbeing programmes that people genuinely look forward to. We work with HR and People teams to ease stress
          and burnout, lift energy and build real connection.
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="relative aspect-[16/9] bg-navy/20">
          <Image src={photo(PHOTOS.corporate, 1500)} alt="" fill sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
        </div>
        <h2 className="mt-12 text-center font-serif text-2xl">Formats</h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-3">
          {FORMATS.map(([t, d]) => (
            <li key={t} className="border-t border-sand pt-4">
              <h3 className="font-serif text-xl">{t}</h3>
              <p className="mt-2 text-sm leading-6 text-navy/80">{d}</p>
            </li>
          ))}
        </ul>
        <h2 className="mt-12 text-center font-serif text-2xl">Outcomes</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-7 text-navy/80">
          Less stress, better sleep and energy, stronger team bonds, and a shared language for looking after
          yourselves. Every programme is built around your team&rsquo;s goals.
        </p>
      </section>

      <section id="enquiry" className="mx-auto max-w-xl scroll-mt-4 px-6 pb-20">
        <h2 className="text-center font-serif text-2xl">Plan it with us</h2>
        <EnquiryForm type="corporate" />
      </section>
    </>
  );
}