import { describe, expect, it } from "vitest";
import { cancelOptions } from "../../lib/policy/options";
import { creditExpiry, isCreditUsable } from "../../lib/policy/credit";
import type { PolicyInput } from "../../lib/policy/types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = new Date("2026-10-07T00:00:00Z");
const startIn = (ms: number) => new Date(now.getTime() + ms);

function input(over: Partial<PolicyInput>): PolicyInput {
  return {
    template: "standard_event",
    startsAt: startIn(100 * HOUR),
    now,
    amountPaidBaseMinor: 10000,
    totalPriceBaseMinor: 10000,
    amountPaidAedMinor: 10000,
    cancelledBy: "guest",
    ...over,
  };
}
const kinds = (i: PolicyInput) => cancelOptions(i).map((o) => o.kind);

describe("cancelOptions: standard_event", () => {
  it("at 48h+1m offers refund, credit, transfer with fees deducted", () => {
    const opts = cancelOptions(input({ startsAt: startIn(48 * HOUR + MIN) }));
    expect(opts.map((o) => o.kind)).toEqual(["refund", "credit", "transfer"]);
    expect(opts[0]).toEqual({ kind: "refund", ratio: 1, deductFees: true });
    expect(opts[1]).toEqual({ kind: "credit", amountAedMinor: 10000 });
  });
  it("at exactly 48h offers credit, transfer", () => {
    expect(kinds(input({ startsAt: startIn(48 * HOUR) }))).toEqual(["credit", "transfer"]);
  });
  it("at 2h+1m offers credit, transfer", () => {
    expect(kinds(input({ startsAt: startIn(2 * HOUR + MIN) }))).toEqual(["credit", "transfer"]);
  });
  it("at exactly 2h offers credit only", () => {
    expect(kinds(input({ startsAt: startIn(2 * HOUR) }))).toEqual(["credit"]);
  });
  it("at -1m offers nothing", () => {
    expect(kinds(input({ startsAt: startIn(-MIN) }))).toEqual([]);
  });
  it("uses absolute hours across timezones", () => {
    const startsAt = new Date("2026-11-08T10:00:00+04:00");
    expect(kinds(input({ startsAt, now: new Date("2026-11-06T05:59:00Z") }))).toContain("refund");
    expect(kinds(input({ startsAt, now: new Date("2026-11-06T06:00:00Z") }))).not.toContain("refund");
  });
});

describe("cancelOptions: standard_retreat", () => {
  const retreat = (over: Partial<PolicyInput>) => input({ template: "standard_retreat", ...over });
  it("at 61 days full refund ratio 1", () => {
    const opts = cancelOptions(retreat({ startsAt: startIn(61 * DAY) }));
    expect(opts).toEqual([{ kind: "refund", ratio: 1, deductFees: true }, { kind: "transfer" }]);
  });
  it("at 45 days paid in full gets ratio 0.5", () => {
    const opts = cancelOptions(
      retreat({ startsAt: startIn(45 * DAY), amountPaidBaseMinor: 100000, totalPriceBaseMinor: 100000 }),
    );
    expect(opts[0]).toEqual({ kind: "refund", ratio: 0.5, deductFees: true });
    expect(opts.map((o) => o.kind)).toEqual(["refund", "transfer"]);
  });
  it("at 45 days with 30% paid has no refund, only transfer", () => {
    expect(
      kinds(retreat({ startsAt: startIn(45 * DAY), amountPaidBaseMinor: 30000, totalPriceBaseMinor: 100000 })),
    ).toEqual(["transfer"]);
  });
  it("band boundaries: exactly 60 days and 30 days are in the 50% band", () => {
    expect(kinds(retreat({ startsAt: startIn(60 * DAY) }))).toEqual(["refund", "transfer"]);
    expect(cancelOptions(retreat({ startsAt: startIn(60 * DAY) }))[0]).toMatchObject({ ratio: 0.5 });
    expect(kinds(retreat({ startsAt: startIn(30 * DAY) }))).toEqual(["refund", "transfer"]);
  });
  it("at 29 days only transfer", () => {
    expect(kinds(retreat({ startsAt: startIn(29 * DAY) }))).toEqual(["transfer"]);
  });
  it("at 1h before start still offers transfer", () => {
    expect(kinds(retreat({ startsAt: startIn(HOUR) }))).toEqual(["transfer"]);
  });
  it("after start offers nothing", () => {
    expect(kinds(retreat({ startsAt: startIn(-MIN) }))).toEqual([]);
  });
});

describe("cancelOptions: Ef Zin cancels", () => {
  it("event 1h before: full refund without fee deduction, or the full amount paid as credit (guest's choice)", () => {
    const opts = cancelOptions(input({ startsAt: startIn(HOUR), cancelledBy: "efzin" }));
    expect(opts).toEqual([
      { kind: "refund", ratio: 1, deductFees: false },
      { kind: "credit", amountAedMinor: 10000 },
      { kind: "transfer" },
    ]);
  });
  it("retreat gets the same regardless of timing", () => {
    const opts = cancelOptions(input({ template: "standard_retreat", startsAt: startIn(5 * DAY), cancelledBy: "efzin" }));
    expect(opts).toEqual([
      { kind: "refund", ratio: 1, deductFees: false },
      { kind: "credit", amountAedMinor: 10000 },
      { kind: "transfer" },
    ]);
  });
});

describe("credit", () => {
  it("creditExpiry adds 12 months", () => {
    expect(creditExpiry(new Date("2026-10-07T00:00:00Z")).toISOString()).toBe("2027-10-07T00:00:00.000Z");
  });
  it("creditExpiry clamps 29 Feb to 28 Feb", () => {
    expect(creditExpiry(new Date("2028-02-29T09:30:00Z")).toISOString()).toBe("2029-02-28T09:30:00.000Z");
  });
  it("isCreditUsable true the day before expiry, false the day after", () => {
    const exp = new Date("2027-10-07T00:00:00Z");
    expect(isCreditUsable(exp, new Date("2027-10-06T00:00:00Z"))).toBe(true);
    expect(isCreditUsable(exp, new Date("2027-10-08T00:00:00Z"))).toBe(false);
  });
});