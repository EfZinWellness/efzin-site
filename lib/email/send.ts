import type { SqlClient } from "../content/sync";
import { getSqlClient } from "../db/client";
import { claimEmail, releaseEmail } from "./log";
import { renderEmail } from "./render";

export type EmailKind =
  | "booking_confirmed"
  | "guest_added"
  | "details_reminder"
  | "day_before"
  | "day_after"
  | "abandoned_checkout"
  | "waitlist_open"
  | "balance_reminder"
  | "credit_expiring"
  | "admin_new_booking"
  | "request_received"
  | "admin_error"
  | "scheduled_payment_upcoming"
  | "scheduled_payment_receipt"
  | "scheduled_payment_failed"
  | "admin_payment_failed"
  | "gift_card_bought"
  | "gift_card_delivered"
  | "gift_card_delivered_buyer"
  | "gift_card_used"
  | "gift_card_expiring"
  | "booking_cancelled_unpaid"
  | "booking_cancelled"
  | "booking_transferred"
  | "payment_refunded";

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface SendOptions {
  /**
   * Stable reference (booking id, item id, card id + date…). With a ref, the email is sent at most
   * once per (kind, to, ref), recorded in email_log. Without one nothing is logged or deduplicated.
   */
  ref?: string;
  /** Database for email_log; defaults to the shared pool. */
  db?: SqlClient | null;
}

export type SendEmailFn = (
  kind: EmailKind,
  to: string,
  data: Record<string, unknown>,
  attachments?: EmailAttachment[],
  opts?: SendOptions,
) => Promise<void>;

export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Resend tags; `kind` names the email kind. */
  tags?: { name: string; value: string }[];
}

export type EmailTransport = (msg: OutgoingEmail) => Promise<void>;

const FROM = "Ef Zin <hello@efzinwellness.com>";
const ADMIN_KINDS = new Set<EmailKind>(["admin_new_booking", "request_received", "admin_error", "admin_payment_failed"]);

let override: EmailTransport | null = null;

/** Test hook: replace the transport. Pass null to restore the default. */
export function setEmailTransport(fn: EmailTransport | null): void {
  override = fn;
}

async function defaultTransport(msg: OutgoingEmail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email] (no RESEND_API_KEY) to=${msg.to.join(",")} subject="${msg.subject}"`);
    return;
  }
  const { Resend } = await import("resend");
  const { error } = await new Resend(key).emails.send(msg);
  if (error) throw new Error(`Resend error: ${error.message}`);
}

/**
 * Renders the kind's branded template (HTML + plain text) and sends it. Admin kinds go to
 * ADMIN_EMAILS when set. With `opts.ref` the email is claimed in email_log first and skipped if
 * already sent; a failed send releases the claim (and throws) so a later run retries it.
 */
export async function sendEmail(
  kind: EmailKind,
  to: string,
  data: Record<string, unknown>,
  attachments?: EmailAttachment[],
  opts?: SendOptions,
): Promise<void> {
  let logDb: SqlClient | null = null;
  if (opts?.ref) {
    logDb = opts.db ?? (await getSqlClient());
    if (logDb && !(await claimEmail(logDb, kind, to, opts.ref))) return;
  }
  try {
    const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const recipients = ADMIN_KINDS.has(kind) && admins.length > 0 ? admins : [to];
    const msg: OutgoingEmail = {
      from: FROM,
      to: recipients,
      ...(await renderEmail(kind, data)),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      tags: [{ name: "kind", value: kind }],
    };
    await (override ?? defaultTransport)(msg);
  } catch (err) {
    if (logDb && opts?.ref) {
      await releaseEmail(logDb, kind, to, opts.ref).catch((e) => console.error("[email] could not release email_log claim", e));
    }
    throw err;
  }
}

/** Sends through `send` without throwing (failures are logged): for emails after a committed change. */
export async function sendQuietly(
  send: SendEmailFn,
  kind: EmailKind,
  to: string,
  data: Record<string, unknown>,
  attachments?: EmailAttachment[],
  opts?: SendOptions,
): Promise<boolean> {
  try {
    if (opts) await send(kind, to, data, attachments, opts);
    else await (attachments ? send(kind, to, data, attachments) : send(kind, to, data));
    return true;
  } catch (err) {
    console.error(`[email] ${kind} to ${to} failed`, err);
    return false;
  }
}
