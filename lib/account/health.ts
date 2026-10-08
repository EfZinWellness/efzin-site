import { z } from "zod";
import type { SqlClient } from "../content/sync";

/** The waiver text lives in content/pages/waiver.mdx; bump this when it changes. */
export const WAIVER_VERSION = "v1";

export const CONSENT_REQUIRED =
  "Please tick the consent box so we can store your health details. Without it we cannot save them.";

const text = z.string().trim().max(1000).optional().default("");

export const HealthSchema = z.object({
  conditions: text,
  injuries: text,
  pregnancy: z.boolean().optional().default(false),
  allergies: text,
  dietary: text,
  consent: z.literal(true, { error: CONSENT_REQUIRED }),
  waiver: z.boolean().optional().default(false),
});

export interface HealthProfile {
  conditions: string;
  injuries: string;
  pregnancy: boolean;
  allergies: string;
  dietary: string;
  consentAt: string | null;
}

export async function loadHealth(
  db: SqlClient,
  personId: string,
): Promise<{ profile: HealthProfile | null; waiverAcceptedAt: string | null }> {
  const h = await db.query<{
    conditions: string | null;
    injuries: string | null;
    pregnancy: boolean;
    allergies: string | null;
    dietary: string | null;
    consent_at: string | Date | null;
  }>("select conditions, injuries, pregnancy, allergies, dietary, consent_at from health_profiles where person_id = $1", [
    personId,
  ]);
  const w = await db.query<{ accepted_at: string | Date }>(
    "select accepted_at from waivers where person_id = $1 and version = $2 order by accepted_at desc limit 1",
    [personId, WAIVER_VERSION],
  );
  const p = h.rows[0];
  return {
    profile: p
      ? {
          conditions: p.conditions ?? "",
          injuries: p.injuries ?? "",
          pregnancy: p.pregnancy,
          allergies: p.allergies ?? "",
          dietary: p.dietary ?? "",
          consentAt: p.consent_at === null ? null : new Date(p.consent_at).toISOString(),
        }
      : null,
    waiverAcceptedAt: w.rows[0] ? new Date(w.rows[0].accepted_at).toISOString() : null,
  };
}

/** True when the person has given health consent and accepted the current waiver. */
export async function healthComplete(db: SqlClient, personId: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `select exists (select 1 from health_profiles where person_id = $1 and consent_at is not null)
        and exists (select 1 from waivers where person_id = $1 and version = $2) as ok`,
    [personId, WAIVER_VERSION],
  );
  return r.rows[0]?.ok === true;
}

export type SaveHealthResult = { ok: true; complete: boolean } | { ok: false; error: string };

/**
 * Saves the signed-in person's health details (explicit consent required: it sets consent_at)
 * and, when ticked, records acceptance of the current waiver (once per version). With both in
 * place, the person's guest rows on upcoming active bookings are marked details_complete.
 */
export async function saveHealth(db: SqlClient, personId: string, input: unknown, now: Date): Promise<SaveHealthResult> {
  const parsed = HealthSchema.safeParse(input);
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((i) => i.path[0] === "consent");
    return { ok: false, error: consentIssue ? CONSENT_REQUIRED : "Please keep each answer under 1,000 characters." };
  }
  const v = parsed.data;
  const at = now.toISOString();
  await db.query(
    `insert into health_profiles (person_id, conditions, injuries, pregnancy, allergies, dietary, consent_at, updated_at)
     values ($1, nullif($2, ''), nullif($3, ''), $4, nullif($5, ''), nullif($6, ''), $7, $7)
     on conflict (person_id) do update set
       conditions = excluded.conditions, injuries = excluded.injuries, pregnancy = excluded.pregnancy,
       allergies = excluded.allergies, dietary = excluded.dietary, consent_at = excluded.consent_at,
       updated_at = excluded.updated_at`,
    [personId, v.conditions, v.injuries, v.pregnancy, v.allergies, v.dietary, at],
  );
  if (v.waiver) {
    await db.query(
      `insert into waivers (person_id, version, accepted_at)
       select $1, $2, $3 where not exists (select 1 from waivers where person_id = $1 and version = $2)`,
      [personId, WAIVER_VERSION, at],
    );
  }
  const complete = await healthComplete(db, personId);
  if (complete) {
    await db.query(
      `update booking_guests g set details_complete = true
         from bookings b join experiences e on e.id = b.experience_id
        where g.booking_id = b.id and g.person_id = $1 and g.details_complete = false
          and b.status in ('paid', 'deposit_paid') and (e.start_at is null or e.start_at > $2)`,
      [personId, at],
    );
  }
  return { ok: true, complete };
}
