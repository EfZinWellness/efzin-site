import { describe, expect, it } from "vitest";
import { allocateDiscounts } from "../../lib/payments/allocate";

const mk = (amts: number[]) =>
  amts.map((amountMinor, seq) => ({ seq, dueOn: `2027-0${seq + 1}-10`, amountMinor, currency: "EUR" as const }));

describe("allocateDiscounts", () => {
  it("applies gift across items in order", () => {
    const r = allocateDiscounts({ schedule: mk([48000, 48000, 48000]), giftAvailableBaseMinor: 60000, creditAvailableBaseMinor: 0 });
    expect(r.schedule.map((i) => i.amountMinor)).toEqual([0, 36000, 48000]);
    expect(r.giftUsedBaseMinor).toBe(60000);
    expect(r.creditUsedBaseMinor).toBe(0);
    expect(r.schedule[1]).toMatchObject({ seq: 1, dueOn: "2027-02-10", currency: "EUR" });
  });
  it("applies gift then credit", () => {
    const r = allocateDiscounts({ schedule: mk([48000, 48000]), giftAvailableBaseMinor: 30000, creditAvailableBaseMinor: 30000 });
    expect(r.schedule.map((i) => i.amountMinor)).toEqual([0, 36000]);
    expect(r.giftUsedBaseMinor).toBe(30000);
    expect(r.creditUsedBaseMinor).toBe(30000);
  });
  it("caps at the total", () => {
    const r = allocateDiscounts({ schedule: mk([48000, 48000]), giftAvailableBaseMinor: 500000, creditAvailableBaseMinor: 1000 });
    expect(r.schedule.map((i) => i.amountMinor)).toEqual([0, 0]);
    expect(r.giftUsedBaseMinor).toBe(96000);
    expect(r.creditUsedBaseMinor).toBe(0);
  });
});
