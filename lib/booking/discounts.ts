import type { SqlClient } from "../content/sync";
import { normaliseCode } from "../giftcards/code";
import { getGiftBalance, reserveGiftCard } from "../giftcards/db";
import { allocateDiscounts, type Allocation } from "../payments/allocate";
import type { ScheduleItem } from "../payments/schedule";
import { convertMinor } from "../pricing/convert";

export type CodeErrorCode = "GIFT_INVALID" | "GIFT_EXPIRED" | "GIFT_INSUFFICIENT" | "CREDIT_INVALID";

export class CodeError extends Error {
  constructor(public readonly code: CodeErrorCode) {
    super(code);
    this.name = "CodeError";
  }
}

/** Smallest card charge we create: a first payment between 0 and this is raised to it by using less gift/credit. */
export const MIN_CHARGE_MINOR: Record<string, number> = { AED: 200, EUR: 50 };

/** Checks a gift card can be spent now; returns its available AED value. */
export async function checkGift(
  db: SqlClient,
  code: string,
  now: Date,
): Promise<{ code: string; cardId: string; availableAed: number }> {
  const bal = await getGiftBalance(db, code);
  if (!bal || (bal.status !== "active" && bal.status !== "expired")) throw new CodeError("GIFT_INVALID");
  if (bal.status === "expired" || (bal.expiresAt && Date.parse(bal.expiresAt) <= now.getTime())) {
    throw new CodeError("GIFT_EXPIRED");
  }
  if (bal.availableAedMinor < 1) throw new CodeError("GIFT_INSUFFICIENT");
  return { code: bal.code, cardId: bal.id, availableAed: bal.availableAedMinor };
}

/** Reserves gift value (card row locked by the DB function). */
export async function reserveGift(
  db: SqlClient,
  code: string,
  amountAed: number,
  pendingId: string,
  expiresAt: Date,
): Promise<string> {
  try {
    return await reserveGiftCard(db, code, amountAed, pendingId, expiresAt);
  } catch (err) {
    const m = /GIFT_INVALID|GIFT_EXPIRED|GIFT_INSUFFICIENT/.exec(err instanceof Error ? err.message : String(err));
    if (m) throw new CodeError(m[0] as CodeErrorCode);
    throw err;
  }
}

/**
 * Locks the credit row (call inside the pending transaction). CREDIT_INVALID when unknown,
 * redeemed, expired, or claimed by another checkout whose claim has not expired.
 */
export async function lockCredit(
  db: SqlClient,
  code: string,
  now: Date,
): Promise<{ id: string; code: string; availableAed: number }> {
  const r = await db.query<{
    id: string;
    code: string;
    amount_aed_minor: number;
    redeemed_booking_id: string | null;
    expires_at: string;
    claimed_pending_id: string | null;
    claim_expires_at: string | null;
  }>(
    `select id, code, amount_aed_minor, redeemed_booking_id, expires_at, claimed_pending_id, claim_expires_at
       from credits where code = $1 for update`,
    [normaliseCode(code)],
  );
  const c = r.rows[0];
  const t = now.getTime();
  const liveClaim = c?.claimed_pending_id && c.claim_expires_at && Date.parse(c.claim_expires_at) > t;
  if (!c || c.redeemed_booking_id || Date.parse(c.expires_at) <= t || liveClaim) throw new CodeError("CREDIT_INVALID");
  return { id: c.id, code: c.code, availableAed: c.amount_aed_minor };
}

export async function claimCredit(db: SqlClient, creditId: string, pendingId: string, expiresAt: Date): Promise<void> {
  await db.query("update credits set claimed_pending_id = $2, claim_expires_at = $3 where id = $1", [
    creditId,
    pendingId,
    expiresAt.toISOString(),
  ]);
}

export interface DiscountPlan {
  allocation: Allocation;
  /** AED to reserve on the gift card / take from the credit (0 = not used). */
  giftAed: number;
  creditAed: number;
}

/**
 * Gift first, then credit. AED → base is floored (never overspend the card), base → AED
 * ceiled. If the first card charge would be below the minimum, less gift (then credit) is used.
 */
export function planDiscounts(i: {
  schedule: ScheduleItem[];
  totalMinor: number;
  base: string;
  rates: Record<string, number>;
  giftAvailableAed: number;
  creditAvailableAed: number;
}): DiscountPlan {
  const toAed = (m: number) => convertMinor(m, i.base, "AED", i.rates, "ceil");
  const toBase = (aed: number) => convertMinor(aed, "AED", i.base, i.rates, "floor");

  const giftCapAed = i.giftAvailableAed > 0 ? Math.min(i.giftAvailableAed, toAed(i.totalMinor)) : 0;
  const giftBase = toBase(giftCapAed);
  const creditCapAed =
    i.creditAvailableAed > 0 ? Math.min(i.creditAvailableAed, toAed(Math.max(0, i.totalMinor - giftBase))) : 0;
  const creditBase = toBase(creditCapAed);

  let allocation = allocateDiscounts({
    schedule: i.schedule,
    giftAvailableBaseMinor: giftBase,
    creditAvailableBaseMinor: creditBase,
  });
  const first = allocation.schedule.find((s) => s.seq === 0)?.amountMinor ?? 0;
  const original = i.schedule.find((s) => s.seq === 0)?.amountMinor ?? 0;
  const target = Math.min(MIN_CHARGE_MINOR[i.base] ?? 0, original);
  let cut = false;
  if (first > 0 && first < target) {
    // The card pays part of seq 0, so every discount sits inside seq 0: using less raises it 1:1.
    const short = target - first;
    const giftCut = Math.min(short, allocation.giftUsedBaseMinor);
    const creditCut = Math.min(short - giftCut, allocation.creditUsedBaseMinor);
    allocation = allocateDiscounts({
      schedule: i.schedule,
      giftAvailableBaseMinor: allocation.giftUsedBaseMinor - giftCut,
      creditAvailableBaseMinor: allocation.creditUsedBaseMinor - creditCut,
    });
    cut = true;
  }
  const aedFor = (used: number, cap: number) => (used <= 0 ? 0 : cut ? Math.min(cap, toAed(used)) : cap);
  return {
    allocation,
    giftAed: aedFor(allocation.giftUsedBaseMinor, giftCapAed),
    creditAed: aedFor(allocation.creditUsedBaseMinor, creditCapAed),
  };
}
