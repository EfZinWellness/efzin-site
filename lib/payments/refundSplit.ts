export interface MoneyBackInput {
  moneyBackBaseMinor: number;
  giftAppliedBaseMinor: number;
  giftCardExpired: boolean;
}

/** Gift part goes back to the gift card (or to credit if it expired); the rest to the card. */
export function splitMoneyBack(i: MoneyBackInput): {
  toGiftCardBaseMinor: number;
  toCreditBaseMinor: number;
  toCardBaseMinor: number;
} {
  const moneyBack = Math.max(0, i.moneyBackBaseMinor);
  const giftPart = Math.min(moneyBack, Math.max(0, i.giftAppliedBaseMinor));
  return {
    toGiftCardBaseMinor: i.giftCardExpired ? 0 : giftPart,
    toCreditBaseMinor: i.giftCardExpired ? giftPart : 0,
    toCardBaseMinor: moneyBack - giftPart,
  };
}
