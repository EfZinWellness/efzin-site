import type { SqlClient } from "../content/sync";

export interface AdminRequest {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  payload: Record<string, unknown>;
  personId: string | null;
  personName: string | null;
  personEmail: string | null;
}

/** Bespoke, corporate, coaching, retreat-interest (and deletion) requests, newest first. */
export async function loadRequests(db: SqlClient, limit = 300): Promise<AdminRequest[]> {
  const r = await db.query<{
    id: string; type: string; status: string; created_at: string | Date; payload: Record<string, unknown> | null;
    person_id: string | null; name: string | null; email: string | null;
  }>(
    `select r.id, r.type, r.status, r.created_at, r.payload, r.person_id, p.name, p.email
       from requests r left join people p on p.id = r.person_id
      order by r.created_at desc, r.id
      limit $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    id: x.id, type: x.type, status: x.status, createdAt: new Date(x.created_at).toISOString(),
    payload: x.payload ?? {}, personId: x.person_id, personName: x.name, personEmail: x.email,
  }));
}
