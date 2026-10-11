import type { AuthAdmin } from "../auth/provision";
import type { SqlClient } from "../content/sync";
import type { Experience } from "../content/schema";
import type { EmailKind } from "../email/send";
import { adminAddress } from "../requests/handlers";
import { startCheckout, type CheckoutResult } from "../stripe/checkout";
import type { StripeApi } from "../stripe/client";
import { TOO_MANY, recordWrongCode, wrongCodeBlocked } from "./codes";
import { CodeError, SoldOutError } from "./pending";
import { validateBooking } from "./validate";

export interface CheckoutHandlerDeps {
  loadExperience: (slug: string) => Promise<Experience | null>;
  /** Runs fn on one dedicated connection; null when no database is configured. */
  withDb: <T>(fn: (db: SqlClient) => Promise<T>) => Promise<T | null>;
  stripe: StripeApi | null;
  usdRates: () => Promise<Record<string, number>>;
  origin: string;
  now: Date;
  sendEmail: (kind: EmailKind, to: string, data: Record<string, unknown>) => Promise<void>;
  /** Member provisioning for bookings confirmed without Stripe; null/absent skips it. */
  auth?: AuthAdmin | null;
  /** The signed-in person's id (session cookie), or null; only then are saved cards offered. */
  currentPersonId?: () => Promise<string | null>;
}

type Body = CheckoutResult | { error: string; errors?: string[]; message?: string };

const UNAVAILABLE = { error: "unavailable", message: "Online booking is not available right now. Please message us." };

/** POST /api/checkout, minus the body cap and request throttle (see the route). */
export async function handleCheckout(
  body: unknown,
  ip: string,
  deps: CheckoutHandlerDeps,
): Promise<{ status: number; body: Body }> {
  const slug = typeof body === "object" && body !== null ? (body as { slug?: unknown }).slug : undefined;
  const experience = typeof slug === "string" ? await deps.loadExperience(slug) : null;
  if (!experience) return { status: 404, body: { error: "not_found" } };

  const v = validateBooking(body, experience, deps.now);
  if (!v.ok) return { status: 400, body: { error: "invalid", errors: v.errors } };
  // Codes entered here count towards the same wrong-code limit as /api/codes/check.
  if ((v.value.giftCode || v.value.creditCode) && (await wrongCodeBlocked(ip, deps.now, deps.sendEmail))) {
    return { status: 429, body: { error: "too_many_attempts", message: TOO_MANY } };
  }
  const stripe = deps.stripe;
  if (!stripe) return { status: 503, body: UNAVAILABLE };

  try {
    const usdRates = await deps.usdRates();
    const signedInPersonId = deps.currentPersonId ? await deps.currentPersonId().catch(() => null) : null;
    const result = await deps.withDb((db) =>
      startCheckout(v.value, {
        signedInPersonId,
        db,
        stripe,
        now: deps.now,
        usdRates,
        origin: deps.origin,
        experience,
        effects: { sendEmail: deps.sendEmail, auth: deps.auth ?? null, origin: deps.origin },
      }),
    );
    return result === null ? { status: 503, body: UNAVAILABLE } : { status: 200, body: result };
  } catch (err) {
    if (err instanceof SoldOutError) return { status: 409, body: { error: "sold_out" } };
    if (err instanceof CodeError) {
      if (err.code === "GIFT_INVALID" || err.code === "CREDIT_INVALID") recordWrongCode(ip, deps.now);
      return err.code === "GIFT_INSUFFICIENT"
        ? { status: 409, body: { error: "gift_insufficient" } }
        : { status: 400, body: { error: err.code.toLowerCase() } };
    }
    console.error("checkout failed", err);
    try {
      await deps.sendEmail("admin_error", adminAddress(), {
        problem: "A guest could not start checkout.",
        slug: experience.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch (mailErr) {
      console.error("admin_error email failed", mailErr);
    }
    return { status: 500, body: { error: "server", message: "Something went wrong. Please try again." } };
  }
}
