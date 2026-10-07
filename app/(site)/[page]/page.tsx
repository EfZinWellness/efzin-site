import Link from "next/link";
import { notFound } from "next/navigation";
import EnquiryForm from "@/components/EnquiryForm";
import Mdx from "@/components/Mdx";
import PageShell from "@/components/PageShell";
import { loadPage } from "@/lib/content/load";
import { INSTAGRAM_URL, WHATSAPP_URL } from "@/lib/site";

const PAGES = ["about", "coaching", "faq", "contact", "terms", "privacy"] as const;
type PageName = (typeof PAGES)[number];

export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.map((page) => ({ page }));
}

const isPage = (s: string): s is PageName => (PAGES as readonly string[]).includes(s);

export async function generateMetadata({ params }: PageProps<"/[page]">) {
  const name = (await params).page;
  if (!isPage(name)) return {};
  const { data } = await loadPage(name);
  return { title: `${data.title} | Ef Zin`, description: data.description as string | undefined };
}

export default async function StaticPage({ params }: PageProps<"/[page]">) {
  const name = (await params).page;
  if (!isPage(name)) notFound();
  const { data, body } = await loadPage(name);
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : undefined);

  return (
    <PageShell title={str("title") ?? name} greek={str("greek")} image={str("image")} imageAlt={str("imageAlt")}>
      <Mdx source={body} />

      {name === "about" ? (
        <p className="mt-10 text-center">
          <Link href="/events" className="btn">See what is on</Link>
        </p>
      ) : null}

      {name === "coaching" ? (
        <section className="mt-12 border-t border-sand/60 pt-10">
          <h2 className="text-center font-serif text-2xl">Tell us about you</h2>
          <div className="mt-6">
            <EnquiryForm type="coaching" />
          </div>
          <p className="mt-8 text-center">
            <a href={WHATSAPP_URL} className="btn">Message Tanya on WhatsApp</a>
          </p>
        </section>
      ) : null}

      {name === "contact" ? (
        <ul className="mt-8 space-y-4 text-center text-sm">
          <li><a href={WHATSAPP_URL} className="btn">WhatsApp</a></li>
          <li>
            <a href="mailto:contact@efzinwellness.com" className="underline underline-offset-4">contact@efzinwellness.com</a>
          </li>
          <li>
            <a href={INSTAGRAM_URL} className="underline underline-offset-4">@efzinwellness on Instagram</a>
          </li>
        </ul>
      ) : null}
    </PageShell>
  );
}