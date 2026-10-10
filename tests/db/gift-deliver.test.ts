import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { FakeStripe } from "./fakeStripe";
import { EVENT, event } from "./webhookFixtures";
import { syncContent, type SqlClient } from "../../lib/content/sync";
import type { EmailAttachment, EmailKind } from "../../lib/email/send";
import { startGiftCheckout, handleGiftCheckout, GiftPurchaseSchema } from "../../lib/giftcards/purchase";
import { deliverDueGiftCards } from "../../lib/giftcards/deliver";
import { activateGiftCards } from "../../lib/giftcards/db";
import { handleBalanceLookup } from "../../lib/giftcards/balance";
import { resetCodeThrottleForTests } from "../../lib/booking/codes";
import { handleStripeEvent, type WebhookDeps } from "../../lib/stripe/handlers";

// 13:00 Dubai, 10 Jan 2027.
const NOW = new Date("2027-01-10T09:00:00Z");
const ORIGIN = "https://efzin.test";

interface Sent {
  kind: EmailKind;
  to: string;
  data: Record<string, unknown>;
  attachments?: EmailAttachment[];
}

let db: PGlite;
let stripe: FakeStripe;
let sent: Sent[];
const sendEmail = async (kind: EmailKind, to: string, data: Record<string, unknown>, attachments?: EmailAttachment[]) => {
  sent.push({ kind, to, data, attachments });
};

beforeEach(async () => {
  db = await freshDb();
  stripe = new FakeStripe();
  sent = [];
  resetCodeThrottleForTests();
  expect((await syncContent(db, [EVENT])).errors).toEqual([]);
});

function purchase(over: Record<string, unknown> = {}) {
  const r = GiftPurchaseSchema(NOW).safeParse({
    amountAedMinor: 50000,
    quantity: 1,
    sendTo: "recipient",
    recipientName: "Noor",
    recipientEmail: "Noor@Example.com",
    message: "Happy birthday",
    deliverOn: "2027-01-10",
    buyerName: "Layla",
    buyerEmail: "layla@example.com",
    ...over,
  });
  if (!r.success) throw new Error(r.error.message);
  return r.data;
}

const deps = () => ({ db: db as SqlClient, stripe, origin: ORIGIN, now: NOW });
const q = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

/** Buys, then simulates the paid webhook (which delivers cards due today). */
async function buyAndPay(over: Record<string, unknown> = {}, amountTotal = 10500) {
  await startGiftCheckout(purchase(over), deps());
  const batch = stripe.sessions[stripe.sessions.length - 1].metadata!.batch_id;
  const wh: WebhookDeps = { db, stripe, auth: null, origin: ORIGIN, sendEmail, now: NOW };
  const evt = event(`evt_${stripe.sessions.length}`, "checkout.session.completed", {
    object: "checkout.session",
    id: `cs_test_${stripe.sessions.length}`,
    mode: "payment",
    payment_status: "paid",
    metadata: { kind: "gift_purchase", batch_id: batch },
    payment_intent: `pi_${stripe.sessions.length}`,
    amount_total: amountTotal,
    currency: "gbp",
  });
  await handleStripeEvent(evt, wh);
  return { batch, wh };
}

describe("startGiftCheckout", () => {
  it("issues one pending card and opens an AED Checkout for the amount", async () => {
    const out = await startGiftCheckout(purchase({ suggestedSlug: "test-event" }), deps());
    expect(out.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

    const cards = await q<Record<string, unknown>>(
      `select g.status, g.initial_aed_minor, g.balance_aed_minor, g.recipient_name, g.recipient_email, g.message,
              to_char(g.deliver_on, 'YYYY-MM-DD') as deliver_on, x.slug, p.email as buyer
         from gift_cards g join people p on p.id = g.buyer_person_id left join experiences x on x.id = g.suggested_experience_id`,
    );
    expect(cards).toEqual([
      {
        status: "pending_payment",
        initial_aed_minor: 50000,
        balance_aed_minor: 0,
        recipient_name: "Noor",
        recipient_email: "noor@example.com",
        message: "Happy birthday",
        deliver_on: "2027-01-10",
        slug: "test-event",
        buyer: "layla@example.com",
      },
    ]);

    expect(stripe.sessions).toHaveLength(1);
    const s = stripe.sessions[0];
    expect(s.mode).toBe("payment");
    expect(s.adaptive_pricing).toEqual({ enabled: true });
    expect(s.allowed_payment_method_types).toEqual(["card"]);
    // The buyer's Stripe customer is attached so they can save their card (wallets included).
    expect(s.customer).toBe("cus_test_1");
    expect(s.customer_email).toBeUndefined();
    expect(stripe.customersCreated).toEqual([expect.objectContaining({ email: "layla@example.com" })]);
    expect(s.saved_payment_method_options).toEqual({ payment_method_save: "enabled", allow_redisplay_filters: ["always", "limited"] });
    expect(s.payment_intent_data).toEqual({ metadata: s.metadata });
    expect(s.line_items).toEqual([
      expect.objectContaining({
        quantity: 1,
        price_data: expect.objectContaining({ currency: "aed", unit_amount: 50000 }),
      }),
    ]);
    expect(s.metadata).toEqual({ kind: "gift_purchase", batch_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(s).not.toHaveProperty("discounts");
    expect(s.allow_promotion_codes).toBeFalsy();
    const batches = await q<{ id: string; quantity: number }>("select id, quantity from gift_card_batches");
    expect(batches).toEqual([{ id: s.metadata!.batch_id, quantity: 1 }]);
    expect(sent).toEqual([]);
  });

  it("issues quantity cards in one batch with one line item of that quantity", async () => {
    await startGiftCheckout(purchase({ quantity: 5, amountAedMinor: 25000 }), deps());
    expect(await q("select 1 from gift_cards where status = 'pending_payment' and purchase_batch_id is not null")).toHaveLength(5);
    expect(stripe.sessions[0].line_items?.[0]).toMatchObject({ quantity: 5, price_data: { unit_amount: 25000 } });
    expect((await q<{ quantity: number }>("select quantity from gift_card_batches"))[0].quantity).toBe(5);
    // Bulk cards carry no recipient or message.
    expect(await q("select 1 from gift_cards where recipient_email is not null or message is not null")).toHaveLength(0);
  });

  it("'send it to me' makes the buyer the recipient", async () => {
    await startGiftCheckout(
      purchase({ sendTo: "me", recipientName: undefined, recipientEmail: undefined }),
      deps(),
    );
    const c = (await q<{ recipient_email: string; recipient_name: string }>("select recipient_email, recipient_name from gift_cards"))[0];
    expect(c).toEqual({ recipient_email: "layla@example.com", recipient_name: "Layla" });
  });

  it("rolls the batch and cards back when issuing fails part way", async () => {
    let inserts = 0;
    const flaky: SqlClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (/insert into gift_cards/i.test(sql) && ++inserts === 2) throw new Error("boom");
        return db.query(sql, params) as never;
      },
    };
    await expect(startGiftCheckout(purchase({ quantity: 3 }), { ...deps(), db: flaky })).rejects.toThrow("boom");
    expect(await q("select 1 from gift_cards")).toHaveLength(0);
    expect(await q("select 1 from gift_card_batches")).toHaveLength(0);
    expect(stripe.sessions).toHaveLength(0);
  });

  it("deletes the pending cards when Stripe definitely rejects the session (4xx)", async () => {
    stripe.createError = Object.assign(new Error("bad"), { statusCode: 400 });
    await expect(startGiftCheckout(purchase({ quantity: 2 }), deps())).rejects.toThrow("bad");
    expect(await q("select 1 from gift_cards")).toHaveLength(0);
    expect(await q("select 1 from gift_card_batches")).toHaveLength(0);
  });

  it("keeps the pending cards when the Stripe failure is ambiguous", async () => {
    stripe.createError = Object.assign(new Error("timeout"), { statusCode: 503 });
    await expect(startGiftCheckout(purchase(), deps())).rejects.toThrow("timeout");
    expect(await q("select 1 from gift_cards where status = 'pending_payment'")).toHaveLength(1);
  });

  it("handleGiftCheckout validates and returns the Checkout URL", async () => {
    const hd = { withDb: async <T,>(fn: (d: SqlClient) => Promise<T>) => fn(db), stripe, origin: ORIGIN, now: NOW, sendEmail };
    const bad = await handleGiftCheckout({ amountAedMinor: 9999 }, hd);
    expect(bad.status).toBe(400);
    const ok = await handleGiftCheckout(
      { amountAedMinor: 50000, sendTo: "me", buyerName: "Layla", buyerEmail: "layla@example.com" },
      hd,
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ url: expect.stringContaining("checkout.stripe.test") });
    const noStripe = await handleGiftCheckout(
      { amountAedMinor: 50000, sendTo: "me", buyerName: "Layla", buyerEmail: "layla@example.com" },
      { ...hd, stripe: null },
    );
    expect(noStripe.status).toBe(503);
  });
});

describe("delivery from the webhook", () => {
  it("sends nothing before the payment is confirmed", async () => {
    await startGiftCheckout(purchase(), deps());
    expect(sent).toEqual([]);
    expect(await deliverDueGiftCards(db, NOW, { sendEmail, origin: ORIGIN })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("delivers a card due today straight away, with the PDF, and notes the buyer", async () => {
    await buyAndPay({ suggestedSlug: "test-event" });
    expect(sent.map((s) => [s.kind, s.to])).toEqual([
      ["gift_card_delivered", "noor@example.com"],
      ["gift_card_delivered_buyer", "layla@example.com"],
      ["gift_card_bought", "layla@example.com"],
    ]);
    const card = sent[0];
    expect(card.data).toMatchObject({
      recipientName: "Noor",
      buyerName: "Layla",
      message: "Happy birthday",
      value: "AED 500",
      suggested: "Test Event",
      bookUrl: `${ORIGIN}/book/test-event`,
    });
    expect(String(card.data.code)).toMatch(/^EFZG-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(card.data.expiresOn).toBe("2028-01-10");
    expect(card.attachments).toHaveLength(1);
    expect(card.attachments![0]).toMatchObject({ contentType: "application/pdf" });
    expect(card.attachments![0].filename).toMatch(/\.pdf$/);
    expect((card.attachments![0].content as Buffer).subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(sent[1].attachments).toBeUndefined();
    expect(await q("select 1 from gift_cards where delivered_at is not null")).toHaveLength(1);
  });

  it("does not deliver a card scheduled for a later day", async () => {
    await buyAndPay({ deliverOn: "2027-02-01" });
    expect(sent.map((s) => s.kind)).toEqual(["gift_card_bought"]); // the receipt only
    expect(await q("select 1 from gift_cards where delivered_at is null and status = 'active'")).toHaveLength(1);
  });

  it("'send it to me' emails the buyer once, with no separate buyer note", async () => {
    await buyAndPay({ sendTo: "me", recipientName: undefined, recipientEmail: undefined });
    expect(sent.map((s) => [s.kind, s.to])).toEqual([["gift_card_delivered", "layla@example.com"]]);
  });

  it("bulk: one email to the buyer with every code and a CSV, nothing to recipients", async () => {
    await buyAndPay({ quantity: 3, amountAedMinor: 25000 }, 31500);
    expect(sent).toHaveLength(1);
    const e = sent[0];
    expect(e.kind).toBe("gift_card_bought");
    expect(e.to).toBe("layla@example.com");
    const codes = (await q<{ code: string }>("select code from gift_cards order by code")).map((r) => r.code);
    expect(codes).toHaveLength(3);
    expect((e.data.codes as string[]).slice().sort()).toEqual(codes);
    expect(e.attachments).toHaveLength(1);
    expect(e.attachments![0]).toMatchObject({ filename: "ef-zin-gift-cards.csv", contentType: "text/csv" });
    const csv = String(e.attachments![0].content);
    expect(csv.split("\n")[0]).toBe("code,value_aed,expires_on");
    for (const c of codes) expect(csv).toContain(`${c},250.00,2028-01-10`);
  });

  it("a webhook retry does not send again", async () => {
    const { wh } = await buyAndPay();
    const before = sent.length;
    await handleStripeEvent(
      event("evt_retry", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_test_1",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "gift_purchase", batch_id: stripe.sessions[0].metadata!.batch_id },
        payment_intent: "pi_1",
        amount_total: 10500,
        currency: "gbp",
      }),
      wh,
    );
    expect(sent).toHaveLength(before);
  });
});

describe("buyer receipt for single gifts", () => {
  it("sends a future-dated gift's receipt once, even when the webhook is retried with a new event id", async () => {
    const { wh } = await buyAndPay({ deliverOn: "2027-02-01", suggestedSlug: "test-event" });
    expect(sent.map((s) => [s.kind, s.to])).toEqual([["gift_card_bought", "layla@example.com"]]);
    const r = sent[0];
    expect(r.data).toMatchObject({
      buyerName: "Layla",
      value: "AED 500",
      recipientLabel: "Noor",
      deliverOn: "1 February 2027",
    });
    expect(String(r.data.codeMasked)).toMatch(/^EFZG-••••-[A-Z2-9]{4}$/);
    const code = (await q<{ code: string }>("select code from gift_cards"))[0].code;
    expect(String(r.data.codeMasked).slice(-4)).toBe(code.slice(-4));
    expect(JSON.stringify(r.data)).not.toContain(code);
    expect(r.attachments).toBeUndefined();

    await handleStripeEvent(
      event("evt_new_id", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_test_1",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "gift_purchase", batch_id: stripe.sessions[0].metadata!.batch_id },
        payment_intent: "pi_1",
        amount_total: 10500,
        currency: "gbp",
      }),
      wh,
    );
    expect(sent).toHaveLength(1);
  });

  it("puts the receipt back when sending it fails, so a retry sends it", async () => {
    const { wh } = await buyAndPay({ deliverOn: "2027-02-01" });
    sent.length = 0;
    await db.query("update gift_cards set buyer_receipt_sent_at = null");
    const failing = async () => {
      throw new Error("down");
    };
    await handleStripeEvent(
      event("evt_f", "checkout.session.completed", {
        object: "checkout.session",
        id: "cs_test_1",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "gift_purchase", batch_id: stripe.sessions[0].metadata!.batch_id },
        payment_intent: "pi_1",
        amount_total: 10500,
        currency: "gbp",
      }),
      { ...wh, sendEmail: failing },
    );
    expect(await q("select 1 from gift_cards where buyer_receipt_sent_at is null")).toHaveLength(1);
  });

  it("send-to-me delivered today is one email, carrying the receipt wording", async () => {
    await buyAndPay({ sendTo: "me", recipientName: undefined, recipientEmail: undefined });
    expect(sent.map((s) => s.kind)).toEqual(["gift_card_delivered"]);
    expect(sent[0].data.receipt).toBe(true);
    expect(await q("select 1 from gift_cards where buyer_receipt_sent_at is not null")).toHaveLength(1);
  });

  it("a gift to a friend delivered today gets the receipt as well as the delivery emails", async () => {
    await buyAndPay();
    expect(sent.map((s) => s.kind).sort()).toEqual(["gift_card_bought", "gift_card_delivered", "gift_card_delivered_buyer"]);
  });

  it("bulk keeps its single gift_card_bought email (no extra receipt)", async () => {
    await buyAndPay({ quantity: 2, amountAedMinor: 25000 }, 21000);
    expect(sent.map((s) => s.kind)).toEqual(["gift_card_bought"]);
    expect(Array.isArray(sent[0].data.codes)).toBe(true);
  });

  it("delivery email mentions the printable card only when a PDF is attached", async () => {
    const { renderEmail } = await import("../../lib/email/render");
    const base = { recipientName: "Noor", code: "EFZG-AAAA-BBBB", value: "AED 500", expiresOn: "2028-01-10", bookUrl: "x" };
    expect((await renderEmail("gift_card_delivered", { ...base, hasPdf: true })).text).toContain("printable card is attached");
    const without = await renderEmail("gift_card_delivered", { ...base, hasPdf: false });
    expect(without.text).not.toContain("printable");
    expect(without.html).not.toContain("printable");
  });
});

describe("deliverDueGiftCards", () => {
  it("sends only due cards, once", async () => {
    await buyAndPay({ deliverOn: "2027-02-01" });
    sent.length = 0;
    const d = { sendEmail, origin: ORIGIN };
    expect(await deliverDueGiftCards(db, new Date("2027-01-31T19:59:00Z"), d)).toBe(0); // 31 Jan in Dubai
    expect(await deliverDueGiftCards(db, new Date("2027-01-31T20:00:00Z"), d)).toBe(1); // 1 Feb in Dubai
    expect(sent.map((s) => s.kind)).toEqual(["gift_card_delivered", "gift_card_delivered_buyer"]);
    expect(await deliverDueGiftCards(db, new Date("2027-02-02T05:00:00Z"), d)).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("puts the card back to undelivered when the email fails, so the next run retries", async () => {
    await buyAndPay({ deliverOn: "2027-02-01" });
    const failing = async () => {
      throw new Error("resend down");
    };
    const later = new Date("2027-02-01T05:00:00Z");
    expect(await deliverDueGiftCards(db, later, { sendEmail: failing, origin: ORIGIN })).toBe(0);
    expect(await q("select 1 from gift_cards where delivered_at is null")).toHaveLength(1);
    expect(await deliverDueGiftCards(db, later, { sendEmail, origin: ORIGIN })).toBe(1);
  });

  it("includes a local estimate for a buyer paying in another currency when sending to themselves", async () => {
    await buyAndPay({ sendTo: "me", recipientName: undefined, recipientEmail: undefined });
    // Delivered at purchase without rates: no estimate. Re-run with rates on a fresh card.
    expect(sent[0].data.estimate).toBeUndefined();
    sent.length = 0;
    await startGiftCheckout(purchase({ sendTo: "me", recipientName: undefined, recipientEmail: undefined }), deps());
    const batch = stripe.sessions[1].metadata!.batch_id;
    await db.query("update gift_cards set stripe_payment_intent = 'pi_x', presentment_currency = 'GBP' where purchase_batch_id = $1", [batch]);
    await activateGiftCards(db, "pi_x", NOW);
    await deliverDueGiftCards(db, NOW, { sendEmail, origin: ORIGIN, usdRates: async () => ({ GBP: 0.79 }) });
    expect(sent[0].data.estimate).toMatch(/^≈ £\d+$/);
  });
});

describe("balance lookup", () => {
  const hd = () => ({ db: db as SqlClient, now: NOW, sendEmail });

  it("shows only balance and expiry for an active card", async () => {
    await buyAndPay({ deliverOn: "2027-02-01" });
    const code = (await q<{ code: string }>("select code from gift_cards"))[0].code;
    const r = await handleBalanceLookup({ code: code.toLowerCase().replace(/-/g, " ") }, "1.1.1.1", hd());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ found: true, balanceAedMinor: 50000, expiresOn: "2028-01-10" });
  });

  it("does not reveal pending or unknown cards, and rate limits wrong codes", async () => {
    await startGiftCheckout(purchase(), deps());
    const code = (await q<{ code: string }>("select code from gift_cards"))[0].code;
    expect((await handleBalanceLookup({ code }, "2.2.2.2", hd())).body).toEqual({ found: false });
    for (let i = 0; i < 9; i++) {
      expect((await handleBalanceLookup({ code: "EFZG-AAAA-AAAA" }, "2.2.2.2", hd())).status).toBe(200);
    }
    const blocked = await handleBalanceLookup({ code: "EFZG-AAAA-AAAA" }, "2.2.2.2", hd());
    expect(blocked.status).toBe(429);
    expect(sent.filter((s) => s.kind === "admin_error")).toHaveLength(1);
  });
});
