import type { SqlClient } from "../content/sync";

/** Work to do once the event's database writes have committed (Stripe calls, emails). */
export type AfterCommit = () => Promise<void>;

/**
 * Runs `fn` for a Stripe event exactly once. The `stripe_events` row is inserted in the same
 * transaction as the handler's writes, so a failure leaves no row and Stripe's retry
 * re-processes the event. A concurrent delivery of the same event waits on the row lock and
 * then sees a duplicate. If the after-commit step throws, the row is deleted again so the
 * retry happens (handlers keep their writes idempotent for that case).
 */
export async function processOnce(
  db: SqlClient,
  eventId: string,
  fn: () => Promise<AfterCommit | void>,
): Promise<"processed" | "duplicate"> {
  let after: AfterCommit | void;
  await db.query("begin");
  try {
    const ins = await db.query<{ id: string }>(
      "insert into stripe_events (id) values ($1) on conflict (id) do nothing returning id",
      [eventId],
    );
    if (!ins.rows[0]) {
      await db.query("commit");
      return "duplicate";
    }
    after = await fn();
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
  if (after) {
    try {
      await after();
    } catch (err) {
      await db
        .query("delete from stripe_events where id = $1", [eventId])
        .catch((e) => console.error(`could not un-record Stripe event ${eventId}`, e));
      throw err;
    }
  }
  return "processed";
}

/** Runs several after-commit steps in order. */
export function sequence(...steps: (AfterCommit | null | undefined | false)[]): AfterCommit {
  return async () => {
    for (const s of steps) if (s) await s();
  };
}
