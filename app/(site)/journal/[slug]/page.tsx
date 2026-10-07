import { notFound } from "next/navigation";
import Mdx from "@/components/Mdx";
import PageShell from "@/components/PageShell";
import { loadPosts } from "@/lib/content/journal";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await loadPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/journal/[slug]">) {
  const { slug } = await params;
  const post = (await loadPosts()).find((p) => p.slug === slug);
  return post ? { title: `${post.title} | Ef Zin`, description: post.excerpt } : {};
}

export default async function JournalPost({ params }: PageProps<"/journal/[slug]">) {
  const { slug } = await params;
  const post = (await loadPosts()).find((p) => p.slug === slug);
  if (!post) notFound();
  return (
    <PageShell title={post.title}>
      <Mdx source={post.body} />
    </PageShell>
  );
}