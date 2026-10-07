import ExperienceDetail, { loadOr404 } from "@/components/ExperienceDetail";

export async function generateMetadata({ params }: PageProps<"/events/[slug]">) {
  const e = await loadOr404((await params).slug, "event");
  return { title: `${e.title} | Ef Zin`, description: e.summary };
}

export default async function EventPage({ params }: PageProps<"/events/[slug]">) {
  const e = await loadOr404((await params).slug, "event");
  return <ExperienceDetail experience={e} />;
}