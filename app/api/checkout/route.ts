import { getAuthAdmin } from "@/lib/auth/provision";
import { handleCheckout } from "@/lib/booking/checkoutHandler";
import { loadExperience } from "@/lib/content/load";
import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { getUsdRates } from "@/lib/pricing/rates";
import { guardPost } from "@/lib/requests/guard";
import { clientIp, createLimiter } from "@/lib/requests/throttle";
import { getStripe } from "@/lib/stripe/client";

/** Own bucket: 20 checkout attempts per 10 minutes per IP. */
const limiter = createLimiter(20, 10 * 60 * 1000);
const allowCheckout = (key: string): boolean => {
  if (limiter.blocked(key)) return false;
  limiter.record(key);
  return true;
};

export async function POST(req: Request) {
  const guarded = await guardPost(req, "checkout", allowCheckout);
  if (guarded instanceof Response) return guarded;
  let body: unknown;
  try {
    body = JSON.parse(guarded.text);
  } catch {
    return Response.json({ error: "invalid", errors: ["Invalid JSON"] }, { status: 400 });
  }
  const res = await handleCheckout(body, clientIp(req), {
    loadExperience,
    withDb: withDbClient,
    stripe: getStripe(),
    usdRates: getUsdRates,
    origin: process.env.NEXT_PUBLIC_SITE_ORIGIN || new URL(req.url).origin,
    now: new Date(),
    sendEmail,
    auth: getAuthAdmin(),
  });
  return Response.json(res.body, { status: res.status });
}
