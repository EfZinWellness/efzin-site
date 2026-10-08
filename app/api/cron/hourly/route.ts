import { runHourly } from "@/lib/cron/hourly";
import { cronOrigin, cronRoute } from "@/lib/cron/route";
import { sendEmail } from "@/lib/email/send";

/** Vercel cron, hourly (`0 * * * *`): releases expired holds and reservations, clears unpaid gift cards. */
export async function GET(req: Request) {
  return cronRoute(req, "hourly", (db, now) => runHourly(db, now, { sendEmail, origin: cronOrigin() }));
}
