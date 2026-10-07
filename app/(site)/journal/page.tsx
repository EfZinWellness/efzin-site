import Link from "next/link";
import { loadPosts } from "@/lib/content/journal";

export const metadata = { title: "Journal | Ef Zin", description: "Recipes and writing from Ef Zin." };

export default async function JournalPage() {
  const posts = await loadPosts();
  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-center font-serif text-4xl">Journal</h1>
      <p className="mt-3 text-center text-sm text-navy/80">Recipes and slow reading.</p>
      <ul className="mt-12 divide-y divide-sand/60">
        {posts.map((p) => (
          <li key={p.slug} className="py-6">
            <p className="eyebrow text-teal">{p.kind === "recipe" ? "Recipe" : "Article"}</p>
            <h2 className="mt-2 font-serif text-2xl">
              <Link href={`/journal/${p.slug}`}>{p.title}</Link>
            </h2>
            {p.excerpt ? <p className="mt-2 text-sm leading-6 text-navy/80">{p.excerpt}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}