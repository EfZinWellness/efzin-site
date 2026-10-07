import { loadJournal } from "./load";

export interface JournalPost {
  slug: string;
  title: string;
  date: string;
  kind: "recipe" | "article";
  excerpt?: string;
  body: string;
}

/** Published posts (draft !== true), newest first. */
export async function loadPosts(): Promise<JournalPost[]> {
  const docs = await loadJournal();
  return docs
    .filter((d) => d.data.draft !== true && typeof d.data.title === "string")
    .map((d) => ({
      slug: d.slug,
      title: d.data.title as string,
      date: String(d.data.date ?? ""),
      kind: d.data.kind === "recipe" ? ("recipe" as const) : ("article" as const),
      excerpt: typeof d.data.excerpt === "string" ? d.data.excerpt : undefined,
      body: d.body,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}