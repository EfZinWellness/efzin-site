import type { SqlClient } from "../content/sync";

export interface PersonInput {
  name?: string;
  email: string;
  phone?: string;
  howHeard?: string;
}

/**
 * Finds the person by lower(email) or creates them. The email is stored lowercased.
 * Blank fields on an existing person are filled in; non-empty fields are never overwritten.
 */
export async function upsertPersonByEmail(db: SqlClient, input: PersonInput): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into people (name, email, phone, how_heard)
     values ($1, lower($2), nullif($3, ''), nullif($4, ''))
     on conflict ((lower(email))) do update set
       name = case when coalesce(people.name, '') = '' then excluded.name else people.name end,
       phone = case when coalesce(people.phone, '') = '' then excluded.phone else people.phone end,
       how_heard = case when coalesce(people.how_heard, '') = '' then excluded.how_heard else people.how_heard end
     returning id`,
    [input.name?.trim() ?? "", input.email.trim(), input.phone ?? "", input.howHeard ?? ""],
  );
  return r.rows[0].id;
}