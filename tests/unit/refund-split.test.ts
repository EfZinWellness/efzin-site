import { describe, expect, it } from "vitest";
import { splitMoneyBack } from "../../lib/payments/refundSplit";

describe("splitMoneyBack", () => {
  it("returns the gift part to the gift card", () => {
    expect(splitMoneyBack({ moneyBackBaseMinor: 50000, giftAppliedBaseMinor: 30000, giftCardExpired: false })).toEqual({
      toGiftCardBaseMinor: 30000,
      toCreditBaseMinor: 0,
      toCardBaseMinor: 20000,
    });
  });
  it("returns the gift part as credit when the card expired", () => {
    expect(splitMoneyBack({ moneyBackBaseMinor: 50000, giftAppliedBaseMinor: 30000, giftCardExpired: true })).toEqual({
      toGiftCardBaseMinor: 0,
      toCreditBaseMinor: 30000,
      toCardBaseMinor: 20000,
    });
  });
  it("caps the gift part at the money back", () => {
    expect(splitMoneyBack({ moneyBackBaseMinor: 10000, giftAppliedBaseMinor: 30000, giftCardExpired: false })).toEqual({
      toGiftCardBaseMinor: 10000,
      toCreditBaseMinor: 0,
      toCardBaseMinor: 0,
    });
  });
});
