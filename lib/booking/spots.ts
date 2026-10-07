/** "Only N spots left" is shown when 1 <= N <= 5; otherwise nothing. */
export function spotsLeftLabel(n: number | null): string | null {
  if (n === null || n < 1 || n > 5) return null;
  return `Only ${n} ${n === 1 ? "spot" : "spots"} left`;
}