import { getAuthAdmin } from "@/lib/auth/provision";
import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { getUsdRates } from "@/lib/pricing/rates";
import { requestOrigin } from "@/lib/requests/origin";
import { getStripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/handlers";
import { processWebhook } from "@/lib/stripe/webhook";

export async function POST(req: Request) {
  const stripe = getStripe();
  // The signature is over the exact bytes Stripe sent: read the raw text, never parsed JSON.
  const body = await req.text();
  const origin = await requestOrigin();
  const res = await processWebhook(body, req.headers.get("stripe-signature"), {
    secret: stripe ? process.env.STRIPE_WEBHOOK_SECRET : undefined,
    verify: (raw, sig, secret) => stripe!.webhooks.constructEvent(raw, sig, secret),
    handle: async (evt) => {
      const done = await withDbClient((db) =>
        handleStripeEvent(evt, {
          db,
          stripe: stripe!,
          sendEmail,
          usdRates: getUsdRates,
          auth: getAuthAdmin(),
          origin,
        }),
      );
      if (done === null) throw new Error("DATABASE_URL is not configured");
    },
    sendEmail,
  });
  return Response.json(res.body, { status: res.status });
}
