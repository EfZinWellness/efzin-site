import type { ScheduleItem } from "./schedule";

export interface AllocationInput {
  schedule: ScheduleItem[];
  giftAvailableBaseMinor: number;
  creditAvailableBaseMinor: number;
}

export interface Allocation {
  /** Amounts reduced, never negative. */
  schedule: ScheduleItem[];
  giftUsedBaseMinor: number;
  creditUsedBaseMinor: number;
}

/** Apply gift value first, then credit, each across items in seq order. */
export function allocateDiscounts(i: AllocationInput): Allocation {
  const items = [...i.schedule].sort((a, b) => a.seq - b.seq).map((s) => ({ ...s }));

  const apply = (available: number): number => {
    let left = Math.max(0, available);
    let used = 0;
    for (const it of items) {
      if (left <= 0) break;
      const take = Math.min(left, it.amountMinor);
      it.amountMinor -= take;
      left -= take;
      used += take;
    }
    return used;
  };

  const giftUsedBaseMinor = apply(i.giftAvailableBaseMinor);
  const creditUsedBaseMinor = apply(i.creditAvailableBaseMinor);
  return { schedule: items, giftUsedBaseMinor, creditUsedBaseMinor };
}
