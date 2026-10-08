import { z } from "zod";
import { TOO_MANY, recordWrongCode, wrongCodeBlocked } from "../booking/codes";
import type { SqlClient } from "../content/sync";
import type { EmailKind } from "../email/send";
import { dubaiToday } from "./dates";
import { isGiftCode, normaliseCode } from "./code";
import { getGiftBalance } from "./db";

export type BalanceBody =
  | { found: true; balanceAedMinor: number; expiresOn: string | null }
  | { found: false; error?: string };

export interface BalanceDeps {
  db: SqlClient;
  now: Date;
  sendEmail: (kind: EmailKind, to: string, data: Record<string, unknown>) => Promise<void>;
}

const Body = z.object({ code: z.string().trim().min(1).max(40) });

/**
 * POST /api/gift/balance. Shows balance and expiry only, never buyer or recipient details.
 * Unknown, unpaid, void and expired codes all answer "not found" and count towards the same
 * per-IP wrong-code limit as /api/codes/check.
 */
export async function handleBalanceLookup(
  body: unknown,
  ip: string,
  deps: BalanceDeps,
): Promise<{ status: number; body: BalanceBody }> {
  if (await wrongCodeBlocked(ip, deps.now, deps.sendEmail)) {
    return { status: 429, body: { found: false, error: TOO_MANY } };
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return { status: 400, body: { found: false, error: "Invalid request" } };
  const code = normaliseCode(parsed.data.code);
  const card = isGiftCode(code) ? await getGiftBalance(deps.db, code) : null;
  const live = card && card.status === "active" && (!card.expiresAt || Date.parse(card.expiresAt) > deps.now.getTime());
  if (!card || !live) {
    recordWrongCode(ip, deps.now);
    return { status: 200, body: { found: false } };
  }
  return {
    status: 200,
    body: {
      found: true,
      balanceAedMinor: card.availableAedMinor,
      expiresOn: card.expiresAt ? dubaiToday(new Date(card.expiresAt)) : null,
    },
  };
}
