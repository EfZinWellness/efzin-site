/** "AED 500", "AED 2,500", or "AED 123.45" when there are fils. */
export function formatAed(minor: number): string {
  const whole = minor % 100 === 0;
  const text = (minor / 100).toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `AED ${text}`;
}
