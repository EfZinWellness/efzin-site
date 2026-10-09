import Link from "next/link";
import { cancelBookingAction } from "@/app/account/bookings/[id]/actions";
import { CancelError, previewCancellation, type CancellationPlan, type CancelChoice } from "@/lib/booking/cancel";
import { formatAmount } from "@/lib/booking/quote";
import { getSqlClient } from "@/lib/db/client";
import { formatAed } from "@/lib/giftcards/money";
import { getStripe } from "@/lib/stripe/client";
import ConfirmForm from "./ConfirmForm";

/** The exact money back of one choice, line by line. */
function Breakdown({ plan }: { plan: CancellationPlan }) {
  const lines: string[] = [
    ...plan.toCardByCharge.map((c) => `${formatAmount(c.amountMinor, c.currency)} back to your card${c.feeMinor > 0 ? ` (after ${formatAmount(c.feeMinor, c.currency)} Stripe fee)` : ""}`),
    ...(plan.toGiftCardAed > 0 ? [`${formatAed(plan.toGiftCardAed)} back on your gift card`] : []),
    ...(plan.toCreditAed > 0 ? [`${formatAed(plan.toCreditAed)} as credit, valid for 12 months`] : []),
  ];
  if (lines.length === 0) return <p className="text-sm">Nothing is refunded under your booking&rsquo;s policy at this point.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

const TITLES: Record<CancelChoice, string> = { refund: "Cancel for a refund", credit: "Cancel for credit" };

/**
 * Shown on the booking page with ?cancel=1 (booker only): each choice the policy allows right
 * now, with its exact amounts, and a confirm step. The amounts are checked again on confirm.
 */
export default async function CancelPanel({ bookingId }: { bookingId: string }) {
  const db = await getSqlClient();
  if (!db) return null;
  const now = new Date();
  const plans: CancellationPlan[] = [];
  for (const choice of ["refund", "credit"] as const) {
    try {
      plans.push(await previewCancellation(db, getStripe(), bookingId, choice, now));
    } catch (err) {
      if (!(err instanceof CancelError)) throw err;
    }
  }
  return (
    <section className="mt-10" data-testid="cancel-panel">
      <h2 className="font-serif text-xl">Cancel your booking</h2>
      {plans.length === 0 ? (
        <p className="mt-3 text-sm">Your booking can no longer be cancelled online. Please message Tanya.</p>
      ) : (
        plans.map((plan) => (
          <div key={plan.choice} className="mt-5 space-y-3 border border-sand p-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em]">
              {plan.choice === "refund" && plan.status === "cancelled" ? "Cancel without a refund" : TITLES[plan.choice]}
            </h3>
            <Breakdown plan={plan} />
            <ConfirmForm
              action={cancelBookingAction}
              fields={{ bookingId, choice: plan.choice, fingerprint: plan.fingerprint }}
              confirmLabel="I understand my booking will be cancelled for everyone on it and this can't be undone."
              label="Confirm cancellation"
              pendingLabel="Cancelling"
            />
          </div>
        ))
      )}
      <Link href={`/account/bookings/${bookingId}`} className="mt-4 inline-block text-xs underline underline-offset-4">
        Keep my booking
      </Link>
    </section>
  );
}
