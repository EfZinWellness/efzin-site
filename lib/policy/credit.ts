/** Credit expires 12 calendar months after issue (UTC); clamps to month end (29 Feb -> 28 Feb). */
export function creditExpiry(issuedAt: Date): Date {
  const y = issuedAt.getUTCFullYear() + 1;
  const m = issuedAt.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(issuedAt.getTime());
  d.setUTCFullYear(y, m, Math.min(issuedAt.getUTCDate(), lastDay));
  return d;
}

export function isCreditUsable(expiresAt: Date, now: Date): boolean {
  return now.getTime() < expiresAt.getTime();
}
