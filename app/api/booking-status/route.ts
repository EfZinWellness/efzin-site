import { bookingStatusBySession, fakeBookingStatus, SESSION_ID_RE } from "@/lib/account/confirmed";
import { getSqlClient } from "@/lib/db/client";
import { clientIp, createLimiter } from "@/lib/requests/throttle";

/** The confirmed page polls every ~2 s for up to 20 s: allow plenty, stop scraping. */
const limiter = createLimiter(120, 10 * 60 * 1000);

/** GET /api/booking-status?session=cs_...: pending | confirmed (first names only). */
export async function GET(req: Request) {
  const ip = clientIp(req);
  if (limiter.blocked(ip)) return Response.json({ error: "too_many" }, { status: 429 });
  limiter.record(ip);
  const session = new URL(req.url).searchParams.get("session") ?? "";
  if (!SESSION_ID_RE.test(session)) return Response.json({ error: "invalid" }, { status: 400 });
  const headers = { "cache-control": "no-store" };

  if (process.env.NODE_ENV !== "production") {
    const fake = fakeBookingStatus(process.env, session);
    if (fake) return Response.json(fake, { headers });
  }
  const db = await getSqlClient();
  if (!db) return Response.json({ status: "pending" }, { headers });
  try {
    return Response.json(await bookingStatusBySession(db, session), { headers });
  } catch (err) {
    console.error("booking status lookup failed", err);
    return Response.json({ status: "pending" }, { headers });
  }
}
