import type { SqlClient } from "../content/sync";
import type { StripeApi } from "../stripe/client";
import { releasePending } from "./pending";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The guest pressed "back" on Stripe Checkout (cancel_url carries the pending id). Expires the
 * session if it is still open, then frees the spots, gift value and credit claim so the guest
 * can retry straight away. Leaves alone anything confirmed, or whose session completed.
 * No "your spot is still waiting" email follows: the guest is on the booking page.
 */
export async function releaseCancelledCheckout(
  db: SqlClient,
  stripe: StripeApi,
  pendingId: string,
): Promise<"released" | "ignored"> {
  if (!UUID_RE.test(pendingId)) return "ignored";
  const r = await db.query<{ checkout_session_id: string | null; confirmed_booking_id: string | null }>(
    "select checkout_session_id, confirmed_booking_id from pending_bookings where id = $1 and kind = 'booking'",
    [pendingId],
  );
  const row = r.rows[0];
  if (!row || row.confirmed_booking_id || !row.checkout_session_id) return "ignored";

  const session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
  if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  else if (session.status !== "expired") return "ignored";

  await db.query("begin");
  try {
    const locked = await db.query<{ confirmed_booking_id: string | null }>(
      "select confirmed_booking_id from pending_bookings where id = $1 for update",
      [pendingId],
    );
    if (locked.rows[0]?.confirmed_booking_id) {
      await db.query("rollback");
      return "ignored";
    }
    await releasePending(db, pendingId);
    await db.query(
      "update pending_bookings set abandoned_notified_at = coalesce(abandoned_notified_at, now()) where id = $1",
      [pendingId],
    );
    await db.query("commit");
    return "released";
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
