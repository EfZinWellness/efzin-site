import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { processWebhook } from "../../lib/stripe/webhook";

const stripe = new Stripe("sk_test_not_used");
const SECRET = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });
const signed = () => stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
const verify = (body: string, sig: string, secret: string) => stripe.webhooks.constructEvent(body, sig, secret);

function deps(handle: (evt: Stripe.Event) => Promise<unknown>) {
  const sent: { kind: string; data: Record<string, unknown>; ref?: string }[] = [];
  return {
    sent,
    d: {
      secret: SECRET,
      verify,
      handle,
      now: () => new Date("2027-01-10T09:15:00Z"),
      sendEmail: async (kind: string, _to: string, data: Record<string, unknown>, _a?: unknown, opts?: { ref?: string }) => {
        sent.push({ kind, data, ref: opts?.ref });
      },
    },
  };
}

describe("origin for links in the money routes", () => {
  it("/api/checkout, /api/gift/checkout and the webhook use requestOrigin, never the request's own URL", () => {
    for (const f of ["app/api/checkout/route.ts", "app/api/gift/checkout/route.ts", "app/api/stripe/webhook/route.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/req(uest)?\.url\)\.origin/);
      expect(src, f).toMatch(/await requestOrigin\(\)/);
      expect(src, f).not.toContain("NEXT_PUBLIC_SITE_ORIGIN");
    }
  });
});

describe("processWebhook", () => {
  it("rejects a bad signature with 400 and does not handle the event", async () => {
    let handled = 0;
    const { d } = deps(async () => handled++);
    expect((await processWebhook(payload, "t=1,v1=bad", d)).status).toBe(400);
    expect((await processWebhook(payload, null, d)).status).toBe(400);
    expect(handled).toBe(0);
  });

  it("handles a correctly signed event and answers 200", async () => {
    const seen: string[] = [];
    const { d } = deps(async (evt) => seen.push(evt.id));
    expect((await processWebhook(payload, signed(), d)).status).toBe(200);
    expect(seen).toEqual(["evt_1"]);
  });

  it("answers 500 and emails Tanya when handling fails, so Stripe retries", async () => {
    const { d, sent } = deps(async () => {
      throw new Error("db down");
    });
    expect((await processWebhook(payload, signed(), d)).status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("admin_error");
    expect(sent[0].data).toMatchObject({ eventId: "evt_1", eventType: "invoice.paid", error: "db down" });
    // Through reportError: at most one alert per hour (email_log ref), not one per Stripe retry.
    expect(sent[0].ref).toBe("stripe_webhook@2027-01-10T09");
  });

  it("answers 503 when no webhook secret is configured", async () => {
    const { d } = deps(async () => {});
    expect((await processWebhook(payload, signed(), { ...d, secret: undefined })).status).toBe(503);
  });
});
