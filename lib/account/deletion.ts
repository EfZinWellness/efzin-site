import type { SqlClient } from "../content/sync";
import { adminAddress } from "../requests/handlers";

/**
 * "Request deletion of my data": one open `deletion` request per person, and an email to Tanya.
 * A repeat while a request is still open records nothing new.
 */
export async function requestDeletion(
  db: SqlClient,
  sendEmail: (kind: "request_received", to: string, data: Record<string, unknown>) => Promise<void>,
  personId: string,
): Promise<{ alreadyRequested: boolean }> {
  const p = await db.query<{ name: string; email: string }>("select name, email from people where id = $1", [personId]);
  const person = p.rows[0];
  if (!person) throw new Error("Person not found");
  const r = await db.query<{ id: string }>(
    `insert into requests (type, payload, person_id)
     select 'deletion', $2::jsonb, $1
      where not exists (select 1 from requests where person_id = $1 and type = 'deletion' and status = 'new')
     returning id`,
    [personId, JSON.stringify({ source: "account" })],
  );
  if (!r.rows[0]) return { alreadyRequested: true };
  try {
    await sendEmail("request_received", adminAddress(), {
      type: "deletion",
      name: person.name,
      email: person.email,
      note: "Data deletion requested from My Ef Zin. Please confirm with the member by email within 30 days.",
    });
  } catch (err) {
    console.error("[account] deletion request email failed", err);
  }
  return { alreadyRequested: false };
}
