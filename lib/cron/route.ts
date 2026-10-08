import { timingSafeEqual } from "node:crypto";
import type { SqlClient } from "../content/sync";
import { withDbClient } from "../db/client";
import { reportError } from "../errors/report";
import { SITE_URL } from "../site";

/** True only for `Authorization: Bearer <CRON_SECRET>` (constant-time); false when no secret is set. */
export function cronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const cronOrigin = (): string => (process.env.NEXT_PUBLIC_SITE_ORIGIN || SITE_URL).replace(/\/+$/, "");

/**
 * A Vercel cron GET: 401 without the bearer secret, 503 without a database, otherwise runs the
 * job on one dedicated connection (jobs use transactions) and answers its summary. An unexpected
 * failure is reported to Tanya and answered 500.
 */
export async function cronRoute(req: Request, name: string, job: (db: SqlClient, now: Date) => Promise<unknown>): Promise<Response> {
  if (!cronAuthorized(req, process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  try {
    const done = await withDbClient(async (db) => ({ result: await job(db, now) }));
    if (done === null) return Response.json({ error: "not_configured" }, { status: 503 });
    return Response.json({ ok: true, result: done.result });
  } catch (err) {
    await reportError(err, `cron_${name}`, { now });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
