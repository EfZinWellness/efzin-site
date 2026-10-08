import { randomBytes } from "node:crypto";
import type { SqlClient } from "../content/sync";
import { ALPHABET, normaliseCode } from "../giftcards/code";
import { creditExpiry } from "../policy/credit";

const MAX_CODE_ATTEMPTS = 5;

function generateCreditCode(): string {
  const bytes = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % 32];
  return `EFZ-${s}`;
}

export type CreditRow = {
  id: string;
  code: string;
  person_id: string;
  amount_aed_minor: number;
  source_booking_id: string | null;
  expires_at: string;
};

export async function issueCredit(
  db: SqlClient,
  personId: string,
  amountAedMinor: number,
  sourceBookingId: string | null,
  now: Date,
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCreditCode();
    const r = await db.query<{ id: string }>(
      `insert into credits (person_id, code, amount_aed_minor, source_booking_id, expires_at)
       values ($1,$2,$3,$4,$5)
       on conflict (code) do nothing
       returning id`,
      [personId, code, amountAedMinor, sourceBookingId, creditExpiry(now).toISOString()],
    );
    if (r.rows[0]) return { id: r.rows[0].id, code };
  }
  throw new Error("CREDIT_CODE_COLLISION");
}

/** A credit that exists, is unredeemed, has not expired and is not claimed by a live checkout. */
export async function findUsableCredit(db: SqlClient, code: string, now: Date): Promise<CreditRow | null> {
  const r = await db.query<CreditRow>(
    `select id, code, person_id, amount_aed_minor, source_booking_id, expires_at
       from credits
      where code = $1 and redeemed_booking_id is null and expires_at > $2
        and (claimed_pending_id is null or claim_expires_at is null or claim_expires_at <= $2)`,
    [normaliseCode(code), now.toISOString()],
  );
  return r.rows[0] ?? null;
}

/**
 * Spends `usedAedMinor` of a credit on a booking in one statement. Any leftover becomes a
 * new credit with a new code and the same expiry. Throws CREDIT_UNUSABLE if the credit is
 * already used, expired, unknown or smaller than the amount.
 */
export async function redeemCredit(
  db: SqlClient,
  creditId: string,
  bookingId: string,
  usedAedMinor: number,
  now: Date,
): Promise<{ leftover: { id: string; code: string } | null }> {
  if (!Number.isInteger(usedAedMinor) || usedAedMinor < 1) throw new Error("CREDIT_UNUSABLE");
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCreditCode();
    // Single statement: the redeem and the leftover insert succeed or fail together.
    // A code collision on the leftover aborts the whole statement, so the loop can retry.
    try {
      const r = await db.query<{ id: string; leftover_id: string | null; leftover_code: string | null }>(
        `with used as (
           update credits set redeemed_booking_id = $2
            where id = $1 and redeemed_booking_id is null and expires_at > $4 and amount_aed_minor >= $3
            returning id, person_id, amount_aed_minor, source_booking_id, expires_at
         ), extra as (
           insert into credits (person_id, code, amount_aed_minor, source_booking_id, expires_at)
           select person_id, $5, amount_aed_minor - $3, source_booking_id, expires_at
             from used where amount_aed_minor > $3
           returning id, code
         )
         select used.id, extra.id as leftover_id, extra.code as leftover_code
           from used left join extra on true`,
        [creditId, bookingId, usedAedMinor, now.toISOString(), code],
      );
      const row = r.rows[0];
      if (!row) throw new Error("CREDIT_UNUSABLE");
      return { leftover: row.leftover_id ? { id: row.leftover_id, code: row.leftover_code! } : null };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const collision = e.code === "23505" || /credits_code_key|duplicate key/i.test(e.message ?? "");
      if (!collision) throw err;
    }
  }
  throw new Error("CREDIT_CODE_COLLISION");
}
