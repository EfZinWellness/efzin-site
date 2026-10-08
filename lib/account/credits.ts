import type { SqlClient } from "../content/sync";

export interface AccountCredit {
  code: string | null;
  amountAedMinor: number;
  /** ISO timestamp */
  expiresAt: string;
}

/** The person's unredeemed, unexpired credits (soonest expiry first) and their total. */
export async function loadCredits(
  db: SqlClient,
  personId: string,
  now: Date,
): Promise<{ totalAedMinor: number; credits: AccountCredit[] }> {
  const r = await db.query<{ code: string | null; amount_aed_minor: number; expires_at: string | Date }>(
    `select code, amount_aed_minor, expires_at from credits
      where person_id = $1 and redeemed_booking_id is null and expires_at > $2
      order by expires_at, created_at`,
    [personId, now.toISOString()],
  );
  const credits = r.rows.map((c) => ({
    code: c.code,
    amountAedMinor: c.amount_aed_minor,
    expiresAt: new Date(c.expires_at).toISOString(),
  }));
  return { totalAedMinor: credits.reduce((s, c) => s + c.amountAedMinor, 0), credits };
}
