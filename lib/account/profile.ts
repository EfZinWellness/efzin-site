import { z } from "zod";
import type { SqlClient } from "../content/sync";

export interface Profile {
  name: string;
  email: string;
  phone: string;
  marketingConsent: boolean;
}

export async function loadProfile(db: SqlClient, personId: string): Promise<Profile | null> {
  const r = await db.query<{ name: string; email: string; phone: string | null; marketing_consent: boolean }>(
    "select name, email, phone, marketing_consent from people where id = $1",
    [personId],
  );
  const p = r.rows[0];
  return p ? { name: p.name, email: p.email, phone: p.phone ?? "", marketingConsent: p.marketing_consent } : null;
}

export const ProfileSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(200),
  phone: z.string().trim().max(40).optional().default(""),
  marketingConsent: z.boolean(),
});

/**
 * Updates the signed-in person's name, phone and newsletter consent. Turning consent off records
 * the withdrawal (so a later form cannot silently re-subscribe them); turning it on here is the
 * member's own explicit choice and clears it. The email is the sign-in identity and is not editable.
 */
export async function saveProfile(
  db: SqlClient,
  personId: string,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your details." };
  const v = parsed.data;
  await db.query(
    `update people set name = $2, phone = nullif($3, ''),
       marketing_consent = $4,
       marketing_consent_at = case when $4 and not marketing_consent then now() else marketing_consent_at end,
       marketing_consent_withdrawn_at = case
         when $4 then null
         when marketing_consent then now()
         else marketing_consent_withdrawn_at end
     where id = $1`,
    [personId, v.name, v.phone, v.marketingConsent],
  );
  return { ok: true };
}
