import { notFound } from "next/navigation";
import ConfirmedStatus from "@/components/ConfirmedStatus";
import { SESSION_ID_RE } from "@/lib/account/confirmed";
import { loadExperience } from "@/lib/content/load";

export const metadata = { title: "Booking confirmed | Ef Zin", robots: { index: false } };

/** Stripe's success_url: /book/{slug}/confirmed?session={CHECKOUT_SESSION_ID}. */
export default async function ConfirmedPage({ params, searchParams }: PageProps<"/book/[slug]/confirmed">) {
  const e = await loadExperience((await params).slug);
  if (!e) notFound();
  const session = (await searchParams).session;
  const sessionId = typeof session === "string" && SESSION_ID_RE.test(session) ? session : null;

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14">
      {sessionId ? (
        <ConfirmedStatus sessionId={sessionId} fallbackTitle={e.title} />
      ) : (
        <div className="text-center">
          <h1 className="font-serif text-3xl">Thank you</h1>
          <p className="mt-4 text-sm leading-6 text-navy/80">
            Your confirmation for {e.title} will arrive by email shortly.
          </p>
        </div>
      )}
    </div>
  );
}
