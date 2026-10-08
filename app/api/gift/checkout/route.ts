import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { handleGiftCheckout } from "@/lib/giftcards/purchase";
import { guardPost } from "@/lib/requests/guard";
import { createLimiter } from "@/lib/requests/throttle";
import { getStripe } from "@/lib/stripe/client";

/** Own bucket: 10 gift checkouts per 10 minutes per IP. */
const limiter = createLimiter(10, 10 * 60 * 1000);
const allowGift = (key: string): boolean => {
  if (limiter.blocked(key)) return false;
  limiter.record(key);
  return true;
};

export async function POST(req: Request) {
  const guarded = await guardPost(req, "gift-checkout", allowGift);
  if (guarded instanceof Response) return guarded;
  let body: unknown;
  try {
    body = JSON.parse(guarded.text);
  } catch {
    return Response.json({ error: "invalid", errors: ["Invalid JSON"] }, { status: 400 });
  }
  const res = await handleGiftCheckout(body, {
    withDb: withDbClient,
    stripe: getStripe(),
    origin: process.env.NEXT_PUBLIC_SITE_ORIGIN || new URL(req.url).origin,
    now: new Date(),
    sendEmail,
  });
  return Response.json(res.body, { status: res.status });
}
