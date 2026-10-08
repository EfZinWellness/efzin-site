import { getAuthAdmin } from "@/lib/auth/provision";
import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { getStripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/handlers";
import { processWebhook } from "@/lib/stripe/webhook";

export async function POST(req: Request) {
  const stripe = getStripe();
  // The signature is over the exact bytes Stripe sent: read the raw text, never parsed JSON.
  const body = await req.text();
  const res = await processWebhook(body, req.headers.get("stripe-signature"), {
    secret: stripe ? process.env.STRIPE_WEBHOOK_SECRET : undefined,
    verify: (raw, sig, secret) => stripe!.webhooks.constructEvent(raw, sig, secret),
    handle: async (evt) => {
      const done = await withDbClient((db) =>
        handleStripeEvent(evt, {
          db,
          stripe: stripe!,
          sendEmail,
          auth: getAuthAdmin(),
          origin: process.env.NEXT_PUBLIC_SITE_ORIGIN || new URL(req.url).origin,
        }),
      );
      if (done === null) throw new Error("DATABASE_URL is not configured");
    },
    sendEmail,
  });
  return Response.json(res.body, { status: res.status });
}
