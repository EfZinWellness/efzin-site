import type { SqlClient } from "../content/sync";
import type { EmailKind } from "../email/send";
import { upsertPersonByEmail } from "../people/upsert";
import { NewsletterSchema, RequestSchema } from "./schema";

type SendFn = (kind: EmailKind, to: string, data: Record<string, unknown>) => Promise<void>;

export interface HandlerResult {
  status: number;
  body: { ok: boolean; stored?: boolean; issues?: unknown[]; error?: string };
}

export const ADMIN_FALLBACK = "contact@efzinwellness.com";

export function adminAddress(): string {
  return process.env.ADMIN_EMAILS?.split(",")[0]?.trim() || ADMIN_FALLBACK;
}

/** Hidden "website" field: humans leave it empty, bots fill it. */
const isHoneypotted = (body: unknown): boolean =>
  typeof body === "object" &&
  body !== null &&
  String((body as Record<string, unknown>).website ?? "").trim() !== "";

export async function handleRequest(
  body: unknown,
  deps: { db: SqlClient | null; sendEmail: SendFn },
): Promise<HandlerResult> {
  if (isHoneypotted(body)) return { status: 200, body: { ok: true, stored: false } };
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false, issues: parsed.error.issues } };
  const { name, email, phone, howHeard, ...rest } = parsed.data;

  let stored = false;
  if (deps.db) {
    try {
      const personId = await upsertPersonByEmail(deps.db, { name, email, phone, howHeard });
      await deps.db.query("insert into requests (type, payload, person_id) values ($1, $2::jsonb, $3)", [
        parsed.data.type,
        JSON.stringify(rest),
        personId,
      ]);
      stored = true;
    } catch (err) {
      console.error("request insert failed", err);
      // Make sure the enquiry is not lost: hand the details to Tanya by email.
      try {
        await deps.sendEmail("admin_error", adminAddress(), {
          problem: "An enquiry could not be saved. Please contact the guest directly.",
          name,
          email,
          phone,
          ...rest,
        });
      } catch (mailErr) {
        console.error("admin_error email failed", mailErr);
      }
      return { status: 500, body: { ok: false, error: "Could not save your enquiry" } };
    }
  }

  try {
    await deps.sendEmail("request_received", adminAddress(), { name, email, phone, howHeard, ...rest });
  } catch (err) {
    console.error("request email failed", err);
  }
  return { status: 200, body: { ok: true, stored } };
}

export async function handleNewsletter(
  body: unknown,
  deps: { db: SqlClient | null },
): Promise<HandlerResult> {
  if (isHoneypotted(body)) return { status: 200, body: { ok: true, stored: false } };
  const parsed = NewsletterSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false, issues: parsed.error.issues } };
  if (!deps.db) return { status: 200, body: { ok: true, stored: false } };
  try {
    const id = await upsertPersonByEmail(deps.db, parsed.data);
    await deps.db.query(
      // Never re-subscribe someone who withdrew consent; the response stays "ok" so the form reveals nothing.
      `update people set marketing_consent = true, marketing_consent_at = coalesce(marketing_consent_at, now())
        where id = $1 and marketing_consent_withdrawn_at is null`,
      [id],
    );
    return { status: 200, body: { ok: true, stored: true } };
  } catch (err) {
    console.error("newsletter failed", err);
    return { status: 500, body: { ok: false, error: "Could not subscribe you" } };
  }
}