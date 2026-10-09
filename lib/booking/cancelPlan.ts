import type { SqlClient } from "../content/sync";
import { splitMoneyBack } from "../payments/refundSplit";
import { cancelOptions } from "../policy/options";
import type { CancelOption, PolicyTemplate } from "../policy/types";
import type { StripeApi } from "../stripe/client";
import { bookingCharges, cardRefunds, type CardRefund } from "../stripe/refund";

export type CancelChoice = "refund" | "credit";
export type CancelledBy = "guest" | "efzin";

/**
 * not_found: no such booking (for this booker). not_active: already cancelled/refunded.
 * not_allowed: the policy doesn't allow this choice now. changed: the amounts differ from the
 * preview the guest confirmed. stripe_unavailable: card money is due but Stripe isn't configured.
 */
export type CancelErrorCode = "not_found" | "not_active" | "not_allowed" | "changed" | "stripe_unavailable";

export class CancelError extends Error {
  constructor(public readonly code: CancelErrorCode) {
    super(code);
    this.name = "CancelError";
  }
}

export interface CancellationPlan {
  /** What the policy allows now (for the person cancelling). */
  options: CancelOption[];
  choice: CancelChoice;
  /** Base-currency money back before it is split (0 for credit or nothing back). */
  moneyBackBaseMinor: number;
  toGiftCardAed: number;
  toCreditAed: number;
  toCardByCharge: CardRefund[];
  /** Sum of the fees deducted (each in its charge's currency; one currency in practice). */
  feesDeductedMinor: number;
  status: "refunded" | "credited" | "cancelled";
  /** Identifies these exact amounts; the confirm step must send back the one it showed. */
  fingerprint: string;
}

export interface CancelBookingRow {
  id: string;
  status: string;
  booker_person_id: string;
  experience_id: string;
  title: string;
  slug: string;
  type: string;
  start_at: string | Date | null;
  timezone: string;
  template: string | null;
  paid_base: number | null;
  total_base: number | null;
  base_currency: string | null;
  amount_aed: number | null;
  gift_card_id: string | null;
  gift_aed: number;
  gift_base: number;
  credit_aed: number;
  credit_base: number;
  /** The gift card can no longer take value back (expired or void, or past its expiry). */
  gift_dead: boolean;
}

/** The booking with everything the policy and the money split need; `lock` takes the row lock. */
export async function loadForCancel(db: SqlClient, bookingId: string, now: Date, lock: boolean): Promise<CancelBookingRow | null> {
  const r = await db.query<CancelBookingRow>(
    `select b.id, b.status, b.booker_person_id, b.experience_id, e.title, e.slug, e.type, e.start_at, e.timezone,
            coalesce(b.policy_snapshot->>'template', e.policy_template) as template,
            b.amount_paid_base_minor as paid_base, coalesce(b.total_price_minor, e.total_price_minor) as total_base,
            coalesce(b.base_currency, e.base_currency) as base_currency, b.amount_aed_minor as amount_aed,
            b.gift_card_id, b.gift_card_applied_aed_minor as gift_aed, b.gift_card_applied_base_minor as gift_base,
            b.credit_applied_aed_minor as credit_aed, b.credit_applied_base_minor as credit_base,
            coalesce(g.status in ('expired', 'void') or g.expires_at <= $2, false) as gift_dead
       from bookings b
       join experiences e on e.id = b.experience_id
       left join gift_cards g on g.id = b.gift_card_id
      where b.id = $1
      ${lock ? "for update of b" : ""}`,
    [bookingId, now.toISOString()],
  );
  return r.rows[0] ?? null;
}

/** Share of a gift/credit amount in AED: all of it when the whole base part comes back. */
const aedOf = (partBase: number, base: number, aed: number) =>
  base <= 0 || partBase <= 0 ? 0 : partBase >= base ? aed : Math.round((aed * partBase) / base);

/**
 * The single source of the cancellation maths (previewCancellation and cancelBooking both use
 * it). Policy on the base amounts actually paid (gift and credit included); refund money back
 * goes to the gift card first (credit when the card is dead), then to the credit used (as new
 * credit), the rest to the card charges in proportion, each minus its own fee when the policy
 * deducts fees. Credit turns the whole paid amount into AED credit.
 *
 * A guest's "refund" with no refund in the policy means cancelling with nothing back. That is
 * refused when credit is on offer or nothing is allowed (after the start), unless `allowForfeit`
 * (the daily job's unpaid-balance cancellation).
 */
export async function planCancellation(
  db: SqlClient,
  stripe: StripeApi | null,
  b: CancelBookingRow,
  choice: CancelChoice,
  cancelledBy: CancelledBy,
  now: Date,
  allowForfeit = false,
): Promise<CancellationPlan> {
  const base = (b.base_currency ?? "AED").toUpperCase();
  const paidBase = b.paid_base ?? 0;
  const giftBase = b.gift_base > 0 ? b.gift_base : base === "AED" ? b.gift_aed : 0;
  const creditBase = b.credit_base > 0 ? b.credit_base : base === "AED" ? b.credit_aed : 0;
  const options = cancelOptions({
    template: (b.template ?? (b.type === "retreat" ? "standard_retreat" : "standard_event")) as PolicyTemplate,
    startsAt: b.start_at ? new Date(b.start_at) : now,
    now,
    amountPaidBaseMinor: paidBase,
    totalPriceBaseMinor: b.total_base ?? paidBase,
    amountPaidAedMinor: base === "AED" ? paidBase : (b.amount_aed ?? 0),
    cancelledBy,
  });
  const done = (p: Omit<CancellationPlan, "options" | "choice" | "feesDeductedMinor" | "fingerprint">): CancellationPlan => ({
    ...p,
    options,
    choice,
    feesDeductedMinor: p.toCardByCharge.reduce((s, c) => s + c.feeMinor, 0),
    fingerprint: JSON.stringify([choice, p.toGiftCardAed, p.toCreditAed, p.toCardByCharge.map((c) => [c.chargeId, c.amountMinor])]),
  });

  if (choice === "credit") {
    const credit = options.find((o) => o.kind === "credit");
    if (!credit) throw new CancelError("not_allowed");
    return done({ moneyBackBaseMinor: 0, toGiftCardAed: 0, toCreditAed: credit.amountAedMinor, toCardByCharge: [], status: "credited" });
  }

  const refund = options.find((o) => o.kind === "refund");
  if (!refund && cancelledBy === "guest" && !allowForfeit && (options.length === 0 || options.some((o) => o.kind === "credit"))) {
    throw new CancelError("not_allowed");
  }
  const moneyBack = refund ? Math.round(paidBase * refund.ratio) : 0;
  const split = splitMoneyBack({ moneyBackBaseMinor: moneyBack, giftAppliedBaseMinor: giftBase, giftCardExpired: b.gift_dead });
  const giftAed = aedOf(split.toGiftCardBaseMinor + split.toCreditBaseMinor, giftBase, b.gift_aed);
  const creditPartBase = Math.min(split.toCardBaseMinor, creditBase);
  const cardPartBase = split.toCardBaseMinor - creditPartBase;
  const cardPaidBase = paidBase - giftBase - creditBase;
  const share = cardPaidBase > 0 ? cardPartBase / cardPaidBase : 0;

  let toCard: CardRefund[] = [];
  if (share > 0) {
    if (!stripe) throw new CancelError("stripe_unavailable");
    toCard = cardRefunds(await bookingCharges(db, stripe, b.id), share, refund?.deductFees ?? false);
  }
  const toGiftCardAed = split.toGiftCardBaseMinor > 0 ? giftAed : 0;
  const toCreditAed = (split.toCreditBaseMinor > 0 ? giftAed : 0) + aedOf(creditPartBase, creditBase, b.credit_aed);
  const anything = toGiftCardAed > 0 || toCreditAed > 0 || toCard.length > 0;
  return done({ moneyBackBaseMinor: moneyBack, toGiftCardAed, toCreditAed, toCardByCharge: toCard, status: anything ? "refunded" : "cancelled" });
}
