export interface CsvCard {
  code: string;
  valueAedMinor: number;
  /** YYYY-MM-DD */
  expiresOn: string;
}

/** AED amount in whole dirhams and fils: 123450 -> "1234.50". */
export function aedDecimal(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** `code,value_aed,expires_on` with one row per card. Codes and dates contain no commas or quotes. */
export function giftCodesCsv(cards: CsvCard[]): string {
  const rows = cards.map((c) => `${c.code},${aedDecimal(c.valueAedMinor)},${c.expiresOn}`);
  return ["code,value_aed,expires_on", ...rows].join("\n") + "\n";
}
