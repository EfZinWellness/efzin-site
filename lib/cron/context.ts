import type { SqlClient } from "../content/sync";
import type { EmailKind, SendEmailFn } from "../email/send";
import { reportError } from "../errors/report";

/** What every scheduled job gets: one database connection, the run's clock and the mailer. */
export interface JobContext {
  db: SqlClient;
  now: Date;
  sendEmail: SendEmailFn;
  /** Site origin for links in emails. */
  origin: string;
}

/** Reports an error for this run (once per context per hour). */
export const report = (ctx: JobContext, err: unknown, context: string, extra?: Record<string, unknown>) =>
  reportError(err, context, { db: ctx.db, now: ctx.now, sendEmail: ctx.sendEmail, ...(extra ? { extra } : {}) });

/**
 * Sends one email at most once per (kind, to, ref) (email_log). A failure is reported and the
 * claim released, so the next run retries; never throws.
 */
export async function mail(
  ctx: JobContext,
  kind: EmailKind,
  to: string,
  data: Record<string, unknown>,
  ref: string,
  /** Facts for Tanya if the send fails (e.g. the booking id). */
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    await ctx.sendEmail(kind, to, data, undefined, { ref, db: ctx.db });
    return true;
  } catch (err) {
    await report(ctx, err, `email_${kind}`, { ref, ...extra });
    return false;
  }
}

/** Runs one step of a job; an error is reported and the job goes on with the next step. */
export async function step<T>(ctx: JobContext, name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    await report(ctx, err, name);
    return null;
  }
}

/** YYYY-MM-DD plus `days`. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `b` to `a` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Start of the Dubai calendar day after `ymd`, i.e. the end of `ymd` in Dubai (UTC+4, no DST). */
export const endOfDubaiDay = (ymd: string): Date => new Date(`${addDays(ymd, 1)}T00:00:00+04:00`);

export const ymd = (v: string | Date): string => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10));
