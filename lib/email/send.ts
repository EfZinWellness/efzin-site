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
  | "admin_error";

export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export type EmailTransport = (msg: OutgoingEmail) => Promise<void>;

const FROM = "Ef Zin <hello@efzinwellness.com>";
const ADMIN_KINDS = new Set<EmailKind>(["admin_new_booking", "request_received", "admin_error"]);

let override: EmailTransport | null = null;

/** Test hook: replace the transport. Pass null to restore the default. */
export function setEmailTransport(fn: EmailTransport | null): void {
  override = fn;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(kind: EmailKind, data: Record<string, unknown>): { subject: string; text: string; html: string } {
  const label = kind.replace(/_/g, " ");
  const subject =
    kind === "request_received"
      ? `New ${String(data.type ?? "").replace(/_/g, " ")} enquiry from ${String(data.name ?? "a guest")}`
      : `Ef Zin: ${label}`;
  const lines = Object.entries(data).map(
    ([k, v]) => `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`,
  );
  const text = lines.join("\n");
  const html = `<p>${lines.map(esc).join("<br>")}</p>`;
  return { subject, text, html };
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

/** Minimal sender; a later task adds templates and an email log. */
export async function sendEmail(kind: EmailKind, to: string, data: Record<string, unknown>): Promise<void> {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const recipients = ADMIN_KINDS.has(kind) && admins.length > 0 ? admins : [to];
  const msg: OutgoingEmail = { from: FROM, to: recipients, ...render(kind, data) };
  await (override ?? defaultTransport)(msg);
}