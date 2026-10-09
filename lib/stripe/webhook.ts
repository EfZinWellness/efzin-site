import type Stripe from "stripe";
import type { SqlClient } from "../content/sync";
import type { SendEmailFn } from "../email/send";
import { reportError } from "../errors/report";

export interface WebhookRequestDeps {
  /** STRIPE_WEBHOOK_SECRET; undefined when not configured. */
  secret: string | undefined;
  /** stripe.webhooks.constructEvent: throws on a bad signature. */
  verify: (body: string, signature: string, secret: string) => Stripe.Event;
  handle: (evt: Stripe.Event) => Promise<unknown>;
  sendEmail: SendEmailFn;
  /** Database for the alert's once-per-hour email_log check (defaults to the shared pool). */
  db?: SqlClient | null;
  /** Clock for the alert's hourly dedupe (tests). */
  now?: () => Date;
}

/**
 * POST /api/stripe/webhook: verifies the signature over the raw body (400 if bad), handles
 * the event (200), or answers 500 so Stripe retries, emailing Tanya about the error at most
 * once an hour (reportError), not on every one of Stripe's retries.
 */
export async function processWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookRequestDeps,
): Promise<{ status: number; body: { received?: true; error?: string } }> {
  if (!deps.secret) return { status: 503, body: { error: "not_configured" } };
  let evt: Stripe.Event;
  try {
    evt = deps.verify(rawBody, signature ?? "", deps.secret);
  } catch {
    return { status: 400, body: { error: "bad_signature" } };
  }
  try {
    await deps.handle(evt);
    return { status: 200, body: { received: true } };
  } catch (err) {
    console.error(`Stripe event ${evt.id} (${evt.type}) failed`);
    await reportError(err, "stripe_webhook", {
      sendEmail: deps.sendEmail,
      ...(deps.db !== undefined ? { db: deps.db } : {}),
      ...(deps.now ? { now: deps.now() } : {}),
      extra: {
        problem: "A Stripe event could not be processed. Stripe will retry it.",
        eventId: evt.id,
        eventType: evt.type,
      },
    });
    return { status: 500, body: { error: "handler_failed" } };
  }
}
