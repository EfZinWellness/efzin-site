import { CodeError, SoldOutError } from "@/lib/booking/pending";
import { validateBooking } from "@/lib/booking/validate";
import { loadExperience } from "@/lib/content/load";
import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { getUsdRates } from "@/lib/pricing/rates";
import { guardPost } from "@/lib/requests/guard";
import { adminAddress } from "@/lib/requests/handlers";
import { startCheckout } from "@/lib/stripe/checkout";
import { getStripe } from "@/lib/stripe/client";

const UNAVAILABLE = { error: "unavailable", message: "Online booking is not available right now. Please message us." };

export async function POST(req: Request) {
  const guarded = await guardPost(req, "checkout");
  if (guarded instanceof Response) return guarded;
  let body: unknown;
  try {
    body = JSON.parse(guarded.text);
  } catch {
    return Response.json({ error: "invalid", errors: ["Invalid JSON"] }, { status: 400 });
  }
  const slug = typeof body === "object" && body !== null ? (body as { slug?: unknown }).slug : undefined;
  const experience = typeof slug === "string" ? await loadExperience(slug) : null;
  if (!experience) return Response.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  const v = validateBooking(body, experience, now);
  if (!v.ok) return Response.json({ error: "invalid", errors: v.errors }, { status: 400 });

  const stripe = getStripe();
  if (!stripe) return Response.json(UNAVAILABLE, { status: 503 });
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN || new URL(req.url).origin;

  try {
    const usdRates = await getUsdRates();
    const result = await withDbClient((db) => startCheckout(v.value, { db, stripe, now, usdRates, origin, experience }));
    if (result === null) return Response.json(UNAVAILABLE, { status: 503 });
    return Response.json(result);
  } catch (err) {
    if (err instanceof SoldOutError) return Response.json({ error: "sold_out" }, { status: 409 });
    if (err instanceof CodeError) {
      return err.code === "GIFT_INSUFFICIENT"
        ? Response.json({ error: "gift_insufficient" }, { status: 409 })
        : Response.json({ error: err.code.toLowerCase() }, { status: 400 });
    }
    console.error("checkout failed", err);
    try {
      await sendEmail("admin_error", adminAddress(), {
        problem: "A guest could not start checkout.",
        slug: experience.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch (mailErr) {
      console.error("admin_error email failed", mailErr);
    }
    return Response.json({ error: "server", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
