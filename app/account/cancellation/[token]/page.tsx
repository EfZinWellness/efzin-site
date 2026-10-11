import { notFound } from "next/navigation";
import { formatExpiry } from "@/lib/account/format";
import { formatAmount } from "@/lib/booking/quote";
import { loadChoiceView } from "@/lib/booking/efzinChoice";
import { getSqlClient } from "@/lib/db/client";
import { formatAed } from "@/lib/giftcards/money";
import { WHATSAPP_URL } from "@/lib/site";
import { confirmCancellationChoice } from "./actions";

export const metadata = { title: "Your cancelled booking | Ef Zin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * After Ef Zin cancels an experience: the booker confirms a full refund or credit. Reached from
 * the email's links (?choice=refund|credit); no login, so it shows only the first name, the
 * experience and the amounts. Nothing happens until the confirm button is pressed (POST).
 */
export default async function CancellationChoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const q = await searchParams;
  const db = await getSqlClient();
  const v = db ? await loadChoiceView(db, token) : null;
  if (!v) notFound();
  const paid = formatAmount(v.amountMinor, v.currency);
  const credit = formatAed(v.creditAedMinor);
  const wanted = q.choice === "refund" || q.choice === "credit" ? q.choice : null;

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-14">
      <p className="eyebrow text-center text-navy/70">Cancelled by Ef Zin</p>
      <h1 className="mt-2 text-center font-serif text-3xl leading-tight">{v.experience}</h1>
      <p className="mt-4 text-center text-sm leading-6 text-navy/80">
        Dear {v.firstName}, we&rsquo;re very sorry this experience has been cancelled. You paid {paid}.
      </p>

      {q.error === "review" ? (
        <p role="alert" className="mt-6 border border-oxblood p-3 text-sm text-oxblood">
          We need to check your payment before we can give you credit. Nothing has changed; we&rsquo;ll be in touch shortly.
        </p>
      ) : null}
      {q.error === "1" ? (
        <p role="alert" className="mt-6 border border-oxblood p-3 text-sm text-oxblood">
          Something went wrong and nothing has changed. Please try again, or message us.
        </p>
      ) : null}

      {v.choice ? (
        <p role="status" className="mt-8 border border-sand p-4 text-sm leading-6">
          {v.choice === "refund"
            ? v.decidedBy === "default"
              ? `We didn't hear back by the deadline, so we refunded you in full (${paid}).`
              : `You chose a full refund of ${paid}. It usually reaches your card within 5 to 10 working days.`
            : `You chose Ef Zin credit of ${credit}. We've emailed you the code.`}{" "}
          We&rsquo;ve emailed you the details.
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          <p className="text-center text-sm leading-6">
            Please choose by {formatExpiry(v.deadlineAt)}. If we don&rsquo;t hear from you, we&rsquo;ll refund you in full.
          </p>
          {(wanted ? [wanted] : (["refund", "credit"] as const)).map((c) => (
            <form key={c} action={confirmCancellationChoice} className="border border-sand p-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="choice" value={c} />
              <p className="text-sm leading-6">
                {c === "refund"
                  ? `A full refund of ${paid}, with no fees deducted (any gift card part goes back onto your gift card).`
                  : `Ef Zin credit of ${credit}, valid for 12 months on any event or retreat.`}
              </p>
              <button type="submit" className="btn btn-solid mt-4 w-full">
                {c === "refund" ? "Confirm: refund me" : "Confirm: give me credit"}
              </button>
            </form>
          ))}
          {wanted ? (
            <a href={`/account/cancellation/${token}?choice=${wanted === "refund" ? "credit" : "refund"}`} className="text-center text-xs underline underline-offset-4">
              {wanted === "refund" ? "I'd rather have credit" : "I'd rather have a refund"}
            </a>
          ) : null}
        </div>
      )}
      <p className="mt-10 text-center text-xs text-navy/70">
        Questions? <a href={WHATSAPP_URL} className="underline underline-offset-4">Message us on WhatsApp</a> or reply to our email.
      </p>
    </div>
  );
}
