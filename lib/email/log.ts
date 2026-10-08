import type { SqlClient } from "../content/sync";

const norm = (to: string) => to.trim().toLowerCase();

/**
 * Claims (kind, to, ref) in email_log. True when this caller should send; false when it was
 * already sent (or is being sent by a concurrent run). Recipients compare case-insensitively.
 */
export async function claimEmail(db: SqlClient, kind: string, to: string, ref: string, now = new Date()): Promise<boolean> {
  const r = await db.query<{ id: string }>(
    `insert into email_log (kind, "to", ref, sent_at) values ($1, $2, $3, $4)
     on conflict (kind, "to", ref) do nothing returning id`,
    [kind, norm(to), ref, now.toISOString()],
  );
  return r.rows.length > 0;
}

/** Undoes a claim after a failed send, so the next run tries again. */
export async function releaseEmail(db: SqlClient, kind: string, to: string, ref: string): Promise<void> {
  await db.query(`delete from email_log where kind = $1 and "to" = $2 and ref = $3`, [kind, norm(to), ref]);
}
