import type { SqlClient } from "../content/sync";
import type { SendEmailFn } from "../email/send";
import { expireGiftCards } from "../giftcards/db";
import type { StripeApi } from "../stripe/client";
import { step, type JobContext } from "./context";
import { chargeDueItems, remindUpcomingPayments } from "./payments";
import { remindExpiringCredits, remindExpiringGiftCards, remindGuests, type ExperienceInfo } from "./reminders";
import { cancelUnpaidBookings, finishPendingRefunds, retryAutoRefunds, sendUnpaidCancellationNotices } from "./unpaid";

export interface DailyDeps {
  /** Null when Stripe is not configured: charging and voiding are skipped and reported. */
  stripe: StripeApi | null;
  sendEmail: SendEmailFn;
  origin: string;
  /** Venue address, map link and timing from the experience's content file (day-before email). */
  experienceInfo?: ExperienceInfo;
}

export interface DailySummary {
  cancelledUnpaid: number | null;
  unpaidNotices: number | null;
  /** Bookings whose failed cancellation refunds were retried. */
  refundRetries: number | null;
  /** Automatic refunds (late payment on an inactive booking, pay-rest excess) made on retry. */
  autoRefundRetries: number | null;
  charged: number | null;
  paymentReminders: number | null;
  guestEmails: number | null;
  creditReminders: number | null;
  giftReminders: number | null;
  giftCardsExpired: number | null;
}

/**
 * The 06:00 Dubai job. Unpaid bookings are cancelled first, so nothing is charged on them; then
 * today's instalments are collected (and, unless the cancel step failed, never-attempted earlier
 * ones) and the reminders sent. Each step's failure is reported to Tanya and the rest still run
 * (a null in the summary). Emails are deduplicated in email_log, so a second run the same day
 * sends nothing new, and a notice that failed is retried on the next run.
 */
export async function runDaily(db: SqlClient, now: Date, deps: DailyDeps): Promise<DailySummary> {
  const ctx: JobContext = { db, now, sendEmail: deps.sendEmail, origin: deps.origin };
  const cancelledUnpaid = await step(ctx, "daily_cancel_unpaid", () => cancelUnpaidBookings(ctx, deps.stripe));
  return {
    cancelledUnpaid,
    unpaidNotices: await step(ctx, "daily_unpaid_notices", () => sendUnpaidCancellationNotices(ctx)),
    refundRetries: await step(ctx, "daily_refund_retries", () => finishPendingRefunds(ctx, deps.stripe)),
    autoRefundRetries: await step(ctx, "daily_auto_refunds", () => retryAutoRefunds(ctx, deps.stripe)),
    // Late catch-up only when the cancel step ran: its rules are what keep a late charge safe.
    charged: await step(ctx, "daily_charge", () => chargeDueItems(ctx, deps.stripe, { catchUp: cancelledUnpaid !== null })),
    paymentReminders: await step(ctx, "daily_payment_reminders", () => remindUpcomingPayments(ctx, deps.stripe)),
    guestEmails: await step(ctx, "daily_guest_reminders", () => remindGuests(ctx, deps.experienceInfo)),
    creditReminders: await step(ctx, "daily_credit_expiring", () => remindExpiringCredits(ctx)),
    giftReminders: await step(ctx, "daily_gift_expiring", () => remindExpiringGiftCards(ctx)),
    giftCardsExpired: await step(ctx, "daily_expire_gift_cards", () => expireGiftCards(db, now)),
  };
}
