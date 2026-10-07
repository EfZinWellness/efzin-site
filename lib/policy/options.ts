import type { CancelOption, PolicyInput } from "./types";

const HOUR_MS = 3_600_000;
const TRANSFER_MIN_HOURS = 2;
const EVENT_REFUND_HOURS = 48;
const RETREAT_FULL_REFUND_HOURS = 60 * 24;
const RETREAT_HALF_BAND_HOURS = 30 * 24;

/** What a guest may do when cancelling. Empty array = nothing allowed. */
export function cancelOptions(i: PolicyInput): CancelOption[] {
  if (i.cancelledBy === "efzin") {
    return [{ kind: "refund", ratio: 1, deductFees: false }, { kind: "transfer" }];
  }

  const hours = (i.startsAt.getTime() - i.now.getTime()) / HOUR_MS;
  if (hours <= 0) return [];

  const out: CancelOption[] = [];

  if (i.template === "standard_event") {
    if (hours > EVENT_REFUND_HOURS) out.push({ kind: "refund", ratio: 1, deductFees: true });
    out.push({ kind: "credit", amountAedMinor: i.amountPaidAedMinor });
    if (hours > TRANSFER_MIN_HOURS) out.push({ kind: "transfer" });
    return out;
  }

  // standard_retreat (no credit)
  if (hours > RETREAT_FULL_REFUND_HOURS) {
    out.push({ kind: "refund", ratio: 1, deductFees: true });
  } else if (hours >= RETREAT_HALF_BAND_HOURS) {
    const paid = i.amountPaidBaseMinor;
    const ratio = paid > 0 ? Math.max(0, paid - 0.5 * i.totalPriceBaseMinor) / paid : 0;
    if (ratio > 0) out.push({ kind: "refund", ratio, deductFees: true });
  }
  out.push({ kind: "transfer" }); // retreats: transfer allowed until start
  return out;
}
