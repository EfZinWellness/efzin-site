import type { SqlClient } from "../content/sync";
import type { SendEmailFn } from "../email/send";
import { expireGiftCards } from "../giftcards/db";
import type { StripeApi } from "../stripe/client";
import { step, type JobContext } from "./context";
import { cancelUnpaidBookings, chargeDueItems, remindUpcomingPayments } from "./payments";
import { remindExpiringCredits, remindExpiringGiftCards, remindGuests } from "./reminders";

export interface DailyDeps {
  /** Null when Stripe is not configured: charging and voiding are skipped and reported. */
  stripe: StripeApi | null;
  sendEmail: SendEmailFn;
  origin: string;
}

export interface DailySummary {
  cancelledUnpaid: number | null;
  charged: number | null;
  paymentReminders: number | null;
  guestEmails: number | null;
  creditReminders: number | null;
  giftReminders: number | null;
  giftCardsExpired: number | null;
}

/**
 * The 06:00 Dubai job. Unpaid bookings are cancelled first, so nothing is charged on them; then
 * today's instalments are collected and the reminders sent. Each step's failure is reported to
 * Tanya and the rest still run (a null in the summary). Emails are deduplicated in email_log, so
 * a second run the same day sends nothing new.
 */
export async function runDaily(db: SqlClient, now: Date, deps: DailyDeps): Promise<DailySummary> {
  const ctx: JobContext = { db, now, sendEmail: deps.sendEmail, origin: deps.origin };
  return {
    cancelledUnpaid: await step(ctx, "daily_cancel_unpaid", () => cancelUnpaidBookings(ctx, deps.stripe)),
    charged: await step(ctx, "daily_charge", () => chargeDueItems(ctx, deps.stripe)),
    paymentReminders: await step(ctx, "daily_payment_reminders", () => remindUpcomingPayments(ctx)),
    guestEmails: await step(ctx, "daily_guest_reminders", () => remindGuests(ctx)),
    creditReminders: await step(ctx, "daily_credit_expiring", () => remindExpiringCredits(ctx)),
    giftReminders: await step(ctx, "daily_gift_expiring", () => remindExpiringGiftCards(ctx)),
    giftCardsExpired: await step(ctx, "daily_expire_gift_cards", () => expireGiftCards(db, now)),
  };
}
