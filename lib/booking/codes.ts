import { z } from "zod";
import type { SqlClient } from "../content/sync";
import type { Experience } from "../content/schema";
import { findUsableCredit } from "../credits/db";
import type { EmailKind } from "../email/send";
import { isGiftCode, normaliseCode } from "../giftcards/code";
import { getGiftBalance } from "../giftcards/db";
import { convertMinor } from "../pricing/convert";
import { adminAddress } from "../requests/handlers";
import { createLimiter } from "../requests/throttle";

const HOUR = 60 * 60 * 1000;
/** Global Constraints: at most 10 wrong gift/credit codes per hour per IP. */
const wrongAttempts = createLimiter(10, HOUR);
/** Tanya is emailed once per IP per hour when it hits the limit. */
const alerts = createLimiter(1, HOUR);

const CREDIT_RE = /^EFZ-[A-HJ-NP-Z2-9]{6}$/;
const BodySchema = z.object({ code: z.string().trim().min(1).max(40), slug: z.string().min(1).max(100) });

export type CodeCheckBody =
  | { valid: true; kind: "gift" | "credit"; availableAed: number; availableBase: number }
  | { valid: false; error?: string };

export interface CodeCheckDeps {
  db: SqlClient;
  usdRates: Record<string, number>;
  now: Date;
  sendEmail: (kind: EmailKind, to: string, data: Record<string, unknown>) => Promise<void>;
  /** The experience named by `slug`, or null when unknown. */
  experience: Pick<Experience, "baseCurrency"> | null;
}

async function lookup(db: SqlClient, code: string, now: Date): Promise<{ kind: "gift" | "credit"; aed: number } | null> {
  if (isGiftCode(code)) {
    const g = await getGiftBalance(db, code);
    const live = g && g.status === "active" && (!g.expiresAt || Date.parse(g.expiresAt) > now.getTime());
    return live && g.availableAedMinor > 0 ? { kind: "gift", aed: g.availableAedMinor } : null;
  }
  if (CREDIT_RE.test(code)) {
    const c = await findUsableCredit(db, code, now);
    return c ? { kind: "credit", aed: c.amount_aed_minor } : null;
  }
  return null;
}

/** POST /api/codes/check. Wrong codes count towards a per-IP limit; the 11th attempt in an hour gets 429. */
export async function handleCodeCheck(
  body: unknown,
  ip: string,
  deps: CodeCheckDeps,
): Promise<{ status: number; body: CodeCheckBody }> {
  const t = deps.now.getTime();
  if (wrongAttempts.blocked(ip, t)) {
    if (!alerts.blocked(ip, t)) {
      alerts.record(ip, t);
      console.warn(`code check: too many wrong codes from ${ip}`);
      try {
        await deps.sendEmail("admin_error", adminAddress(), {
          problem: "Repeated wrong gift card / credit codes (possible guessing). Further attempts are blocked for an hour.",
          ip,
        });
      } catch (err) {
        console.error("admin_error email failed", err);
      }
    }
    return { status: 429, body: { valid: false, error: "Too many attempts. Please try again later." } };
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success || !deps.experience) return { status: 400, body: { valid: false, error: "Invalid request" } };

  const found = await lookup(deps.db, normaliseCode(parsed.data.code), deps.now);
  if (!found) {
    wrongAttempts.record(ip, t);
    return { status: 200, body: { valid: false } };
  }
  const availableBase = convertMinor(found.aed, "AED", deps.experience.baseCurrency, { ...deps.usdRates, USD: 1 }, "floor");
  return { status: 200, body: { valid: true, kind: found.kind, availableAed: found.aed, availableBase } };
}

export function resetCodeThrottleForTests(): void {
  wrongAttempts.reset();
  alerts.reset();
}
