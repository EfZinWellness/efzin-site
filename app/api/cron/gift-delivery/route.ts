import { runGiftDelivery } from "@/lib/cron/giftDelivery";
import { cronOrigin, cronRoute } from "@/lib/cron/route";
import { sendEmail } from "@/lib/email/send";
import { getUsdRates } from "@/lib/pricing/rates";

export const maxDuration = 300;

/** Vercel cron, 08:00 Dubai (`0 4 * * *`): emails the gift cards due today (with the printable PDF). */
export async function GET(req: Request) {
  return cronRoute(req, "gift_delivery", (db, now) =>
    runGiftDelivery(db, now, { sendEmail, origin: cronOrigin(), usdRates: getUsdRates }),
  );
}
