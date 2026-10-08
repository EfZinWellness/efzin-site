import type { SqlClient } from "../content/sync";
import { sendEmail, type SendEmailFn } from "../email/send";
import { adminAddress } from "../requests/handlers";

export interface ReportOptions {
  /** Database for the once-per-hour email_log check (defaults to the shared pool). */
  db?: SqlClient | null;
  now?: Date;
  sendEmail?: SendEmailFn;
  /** Extra facts for Tanya (ids, amounts). No secrets. */
  extra?: Record<string, unknown>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Logs an error and emails Tanya (`admin_error`) at most once per `context` per hour: the email
 * is deduplicated in email_log with ref `context@YYYY-MM-DDTHH` (UTC hour). Never throws.
 */
export async function reportError(err: unknown, context: string, opts: ReportOptions = {}): Promise<void> {
  console.error(`[error] ${context}`, err);
  const now = opts.now ?? new Date();
  const hour = now.toISOString().slice(0, 13);
  try {
    await (opts.sendEmail ?? sendEmail)(
      "admin_error",
      adminAddress(),
      { context, problem: `Error in ${context.replace(/_/g, " ")}.`, error: message(err), at: now.toISOString(), ...opts.extra },
      undefined,
      { ref: `${context}@${hour}`, ...(opts.db !== undefined ? { db: opts.db } : {}) },
    );
  } catch (mailErr) {
    console.error(`[error] could not email the report for ${context}`, mailErr);
  }
}
