import ExperienceDetail, { loadOr404 } from "@/components/ExperienceDetail";

export async function generateMetadata({ params }: PageProps<"/retreats/[slug]">) {
  const e = await loadOr404((await params).slug, "retreat");
  return { title: `${e.title} | Ef Zin`, description: e.summary };
}

export default async function RetreatPage({ params }: PageProps<"/retreats/[slug]">) {
  const e = await loadOr404((await params).slug, "retreat");
  return <ExperienceDetail experience={e} />;
}