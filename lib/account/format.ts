/** "Sat 25 Oct 2026, 10:00" in the experience's own timezone; "Date to be confirmed" without a date. */
export function formatStart(startAt: string | null, timezone: string): string {
  if (!startAt) return "Date to be confirmed";
  const d = new Date(startAt);
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(d);
  return `${day}, ${time}`;
}

/** "Saturday" or "12 June" for the confirmed page's "See you at … on …". */
export function formatDayName(startAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(
    new Date(startAt),
  );
}

/** "12 Mar 2027" (Dubai calendar date) for expiry dates. */
export function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(
    new Date(iso),
  );
}

export const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  deposit_paid: "On a payment plan",
  refunded: "Refunded",
  cancelled: "Cancelled",
  credited: "Moved to credit",
};

export const ITEM_LABELS: Record<string, string> = {
  paid: "Paid",
  scheduled: "Upcoming",
  failed: "Failed",
  cancelled: "Cancelled",
};
