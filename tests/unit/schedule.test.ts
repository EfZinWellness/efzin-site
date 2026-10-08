import { describe, expect, it } from "vitest";
import { availableOptions, balanceDueDate, buildSchedule } from "../../lib/payments/schedule";
import { convertMinor } from "../../lib/pricing/convert";

const tz = "Europe/Athens";
const startsAt = new Date("2027-06-10T07:00:00Z");
const base = { depositPct: 20, currency: "EUR" as const, balanceDueDays: 10, maxInstalments: 4, timezone: tz, startsAt };
const at = (d: string) => new Date(`${d}T10:00:00Z`);

describe("balanceDueDate", () => {
  it("is start date minus balanceDueDays", () => {
    expect(balanceDueDate(startsAt, 10, tz)).toBe("2027-05-31");
  });
});

describe("buildSchedule", () => {
  it("full is one item today", () => {
    const s = buildSchedule({ ...base, option: "full", totalMinor: 240000, bookedAt: at("2027-01-10") });
    expect(s).toEqual([{ seq: 0, dueOn: "2027-01-10", amountMinor: 240000, currency: "EUR" }]);
  });
  it("deposit_balance: balance on 2027-05-31", () => {
    const s = buildSchedule({ ...base, option: "deposit_balance", totalMinor: 240000, bookedAt: at("2027-01-10") });
    expect(s.map((i) => [i.seq, i.dueOn, i.amountMinor])).toEqual([
      [0, "2027-01-10", 48000],
      [1, "2027-05-31", 192000],
    ]);
  });
  it("4 instalments when booked 2027-01-10", () => {
    const s = buildSchedule({ ...base, option: "instalments", totalMinor: 240000, bookedAt: at("2027-01-10") });
    expect(s.map((i) => [i.dueOn, i.amountMinor])).toEqual([
      ["2027-01-10", 48000],
      ["2027-02-10", 48000],
      ["2027-03-10", 48000],
      ["2027-04-10", 48000],
      ["2027-05-10", 48000],
    ]);
  });
  it("3 instalments when booked 2027-02-10", () => {
    const s = buildSchedule({ ...base, option: "instalments", totalMinor: 240000, bookedAt: at("2027-02-10") });
    expect(s.slice(1).map((i) => [i.dueOn, i.amountMinor])).toEqual([
      ["2027-03-10", 64000],
      ["2027-04-10", 64000],
      ["2027-05-10", 64000],
    ]);
  });
  it("2 instalments when booked 2027-03-10", () => {
    const s = buildSchedule({ ...base, option: "instalments", totalMinor: 240000, bookedAt: at("2027-03-10") });
    expect(s.slice(1).map((i) => i.amountMinor)).toEqual([96000, 96000]);
  });
  it("clamps monthly dates to month end", () => {
    const s = buildSchedule({
      ...base,
      option: "instalments",
      totalMinor: 240000,
      bookedAt: at("2027-01-31"),
      startsAt: new Date("2027-07-15T07:00:00Z"),
    });
    expect(s.slice(1).map((i) => i.dueOn)).toEqual(["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  });
  it("puts the rounding remainder on the last instalment", () => {
    const s = buildSchedule({
      ...base,
      option: "instalments",
      totalMinor: 100000,
      bookedAt: at("2027-03-10"),
      maxInstalments: 3,
      startsAt: new Date("2027-07-10T07:00:00Z"),
    });
    expect(s.map((i) => i.amountMinor)).toEqual([20000, 26666, 26666, 26668]);
  });
});

describe("availableOptions", () => {
  const opts = (d: string) =>
    availableOptions({
      bookedAt: at(d),
      startsAt,
      balanceDueDays: 10,
      maxInstalments: 4,
      timezone: tz,
      allowed: ["full", "deposit_balance", "instalments"],
    });
  it("offers everything early", () => {
    expect(opts("2027-01-10")).toEqual(["full", "deposit_balance", "instalments"]);
  });
  it("drops instalments when fewer than 2", () => {
    expect(opts("2027-04-25")).toEqual(["full", "deposit_balance"]);
  });
  it("only full after balance due date", () => {
    expect(opts("2027-06-05")).toEqual(["full"]);
  });
  it("respects allowed", () => {
    expect(
      availableOptions({
        bookedAt: at("2027-01-10"),
        startsAt,
        balanceDueDays: 10,
        maxInstalments: 4,
        timezone: tz,
        allowed: ["full"],
      }),
    ).toEqual(["full"]);
  });
});

describe("convertMinor", () => {
  it("converts AED gift value to EUR without overspending", () => {
    const eur = convertMinor(50000, "AED", "EUR", { EUR: 0.92 }, "floor");
    expect(eur).toBe(12525);
    expect(convertMinor(12525, "EUR", "AED", { EUR: 0.92 }, "ceil")).toBeLessThanOrEqual(50000);
  });
  it("returns the amount unchanged for same currency", () => {
    expect(convertMinor(123, "EUR", "EUR", { EUR: 0.92 }, "round")).toBe(123);
  });
});
