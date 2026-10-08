import { loadExperience } from "@/lib/content/load";
import { runDaily } from "@/lib/cron/daily";
import { cronOrigin, cronRoute } from "@/lib/cron/route";
import { sendEmail } from "@/lib/email/send";
import { getStripe } from "@/lib/stripe/client";

export const maxDuration = 300;

/** Vercel cron, 06:00 Dubai (`0 2 * * *`): reminders, instalments, unpaid cancellations, expiries. */
export async function GET(req: Request) {
  return cronRoute(req, "daily", (db, now) =>
    runDaily(db, now, { stripe: getStripe(), sendEmail, origin: cronOrigin(), experienceInfo: loadExperience }),
  );
}
