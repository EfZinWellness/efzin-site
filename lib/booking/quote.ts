import type { Experience } from "../content/schema";
import { availableOptions, buildSchedule, type PaymentOption, type ScheduleItem } from "../payments/schedule";
import { currencyExponent } from "../pricing/currency";

/** Pure pricing helpers shared by the booking form (client) and checkout (server). */

/** Spec §6.3: the balance is due 10 days before arrival. */
export const BALANCE_DUE_DAYS = 10;
export const DEFAULT_DEPOSIT_PCT = 20;

export const OPTION_LABELS: Record<PaymentOption, string> = {
  full: "Pay in full",
  deposit_balance: "Deposit + balance",
  instalments: "Deposit + monthly payments",
};

export type QuoteExperience = Pick<
  Experience,
  "startsAt" | "timezone" | "paymentOptions" | "maxInstalments" | "depositPct" | "baseCurrency" | "tickets"
>;

export interface TicketLine {
  ticketKey: string;
  qty: number;
}

/** Sum of ticket price × quantity, in base minor units. Unknown keys count as 0 (validation rejects them). */
export function bookingTotal(e: Pick<Experience, "tickets">, lines: TicketLine[]): number {
  return lines.reduce((sum, l) => sum + (e.tickets.find((t) => t.key === l.ticketKey)?.priceMinor ?? 0) * l.qty, 0);
}

/** The payment options this experience offers to someone booking at `now`. */
export function paymentOptionsFor(e: QuoteExperience, now: Date): PaymentOption[] {
  return availableOptions({
    allowed: e.paymentOptions,
    bookedAt: now,
    startsAt: new Date(e.startsAt),
    balanceDueDays: BALANCE_DUE_DAYS,
    maxInstalments: e.maxInstalments,
    timezone: e.timezone,
  });
}

/** "€480" for whole amounts, "€266.66" otherwise. */
export function formatAmount(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const whole = minor % 10 ** exp === 0;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : exp,
    maximumFractionDigits: whole ? 0 : exp,
  }).format(minor / 10 ** exp);
}

/** "31 May 2027" from a YYYY-MM-DD calendar date. */
export function formatDueDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function scheduleFor(e: QuoteExperience, totalMinor: number, option: PaymentOption, now: Date): ScheduleItem[] {
  return buildSchedule({
    option,
    totalMinor,
    depositPct: e.depositPct ?? DEFAULT_DEPOSIT_PCT,
    currency: e.baseCurrency,
    bookedAt: now,
    startsAt: new Date(e.startsAt),
    balanceDueDays: BALANCE_DUE_DAYS,
    maxInstalments: e.maxInstalments,
    timezone: e.timezone,
  });
}
