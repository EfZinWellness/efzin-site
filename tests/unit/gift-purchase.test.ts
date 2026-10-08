import { describe, it, expect } from "vitest";
import { GiftPurchaseSchema, GIFT_PRESETS_AED_MINOR } from "../../lib/giftcards/purchase";
import { addMonthsYmd, dubaiToday } from "../../lib/giftcards/dates";
import { renderGiftCardPdf } from "../../lib/email/pdf/GiftCardPdf";
import { giftCodesCsv } from "../../lib/giftcards/csv";

// 13:00 in Dubai on 10 Jan 2027.
const NOW = new Date("2027-01-10T09:00:00Z");

const base = {
  amountAedMinor: 50000,
  quantity: 1,
  sendTo: "recipient",
  recipientName: "Noor",
  recipientEmail: "noor@example.com",
  message: "Happy birthday",
  deliverOn: "2027-01-10",
  buyerName: "Layla",
  buyerEmail: "layla@example.com",
};
const parse = (over: Record<string, unknown> = {}, now = NOW) => GiftPurchaseSchema(now).safeParse({ ...base, ...over });

describe("Dubai dates", () => {
  it("uses the Dubai calendar day, not UTC", () => {
    expect(dubaiToday(new Date("2027-01-10T21:00:00Z"))).toBe("2027-01-11");
    expect(dubaiToday(new Date("2027-01-10T19:59:00Z"))).toBe("2027-01-10");
  });
  it("adds months and clamps to month end", () => {
    expect(addMonthsYmd("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsYmd("2027-01-10", 12)).toBe("2028-01-10");
  });
});

describe("GiftPurchaseSchema", () => {
  it("accepts every preset and custom values at the limits", () => {
    for (const a of GIFT_PRESETS_AED_MINOR) expect(parse({ amountAedMinor: a }).success).toBe(true);
    expect(GIFT_PRESETS_AED_MINOR).toEqual([25000, 50000, 100000, 250000]);
    expect(parse({ amountAedMinor: 10000 }).success).toBe(true);
    expect(parse({ amountAedMinor: 1000000 }).success).toBe(true);
    expect(parse({ amountAedMinor: 33300 }).success).toBe(true);
  });

  it("rejects values outside AED 100-10,000", () => {
    expect(parse({ amountAedMinor: 9999 }).success).toBe(false);
    expect(parse({ amountAedMinor: 1000001 }).success).toBe(false);
    expect(parse({ amountAedMinor: 500.5 }).success).toBe(false);
  });

  it("limits quantity to 1-50", () => {
    expect(parse({ quantity: 50 }).success).toBe(true);
    expect(parse({ quantity: 51 }).success).toBe(false);
    expect(parse({ quantity: 0 }).success).toBe(false);
  });

  it("limits the message to 300 characters", () => {
    expect(parse({ message: "x".repeat(300) }).success).toBe(true);
    expect(parse({ message: "x".repeat(301) }).success).toBe(false);
  });

  it("accepts a delivery date from today to 12 months ahead (Dubai dates)", () => {
    expect(parse({ deliverOn: "2027-01-10" }).success).toBe(true);
    expect(parse({ deliverOn: "2028-01-10" }).success).toBe(true);
    expect(parse({ deliverOn: "2028-02-10" }).success).toBe(false); // 13 months
    expect(parse({ deliverOn: "2028-01-11" }).success).toBe(false);
    expect(parse({ deliverOn: "2027-01-09" }).success).toBe(false);
    expect(parse({ deliverOn: "2027-02-30" }).success).toBe(false);
    // 21:00Z on the 10th is already the 11th in Dubai.
    expect(parse({ deliverOn: "2027-01-10" }, new Date("2027-01-10T21:00:00Z")).success).toBe(false);
  });

  it("defaults the delivery date to today in Dubai", () => {
    const r = parse({ deliverOn: undefined });
    expect(r.success && r.data.deliverOn).toBe("2027-01-10");
  });

  it("requires recipient name and email when sending to a recipient", () => {
    expect(parse({ recipientEmail: undefined }).success).toBe(false);
    expect(parse({ recipientName: "" }).success).toBe(false);
    expect(parse({ recipientEmail: "not-an-email" }).success).toBe(false);
  });

  it("'me' needs no recipient and drops any recipient fields", () => {
    const r = parse({ sendTo: "me", recipientName: undefined, recipientEmail: undefined });
    expect(r.success).toBe(true);
    const r2 = parse({ sendTo: "me" });
    expect(r2.success && r2.data.recipientEmail).toBeUndefined();
  });

  it("bulk ignores recipient, message and date: everything goes to the buyer today", () => {
    const r = parse({ quantity: 12, deliverOn: "2027-06-01" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.recipientEmail).toBeUndefined();
      expect(r.data.message).toBeUndefined();
      expect(r.data.deliverOn).toBe("2027-01-10");
    }
  });

  it("requires buyer name and email, and rejects a filled honeypot", () => {
    expect(parse({ buyerEmail: "x" }).success).toBe(false);
    expect(parse({ buyerName: "" }).success).toBe(false);
    expect(parse({ website: "http://spam" }).success).toBe(false);
    expect(parse({ website: "" }).success).toBe(true);
  });

  it("ignores any discount or promo field", () => {
    const r = parse({ discounts: [{ coupon: "x" }], giftCode: "EFZG-AAAA-BBBB" });
    expect(r.success && Object.keys(r.data)).not.toContain("discounts");
    expect(r.success && Object.keys(r.data)).not.toContain("giftCode");
  });
});

describe("gift card PDF and CSV", () => {
  it("renders a non-empty PDF", async () => {
    const buf = await renderGiftCardPdf({
      code: "EFZG-ABCD-EFGH",
      valueAedMinor: 50000,
      recipientName: "Noor",
      message: "Happy birthday, with love.",
      expiresOn: "2028-01-10",
      suggestedTitle: "Sunrise Yoga & Brunch",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 30_000);

  it("renders without optional parts", async () => {
    const buf = await renderGiftCardPdf({ code: "EFZG-ABCD-EFGH", valueAedMinor: 25000, expiresOn: "2028-01-10" });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 30_000);

  it("writes codes as code,value_aed,expires_on", () => {
    const csv = giftCodesCsv([
      { code: "EFZG-AAAA-BBBB", valueAedMinor: 50000, expiresOn: "2028-01-10" },
      { code: "EFZG-CCCC-DDDD", valueAedMinor: 123450, expiresOn: "2028-01-10" },
    ]);
    expect(csv).toBe(
      "code,value_aed,expires_on\nEFZG-AAAA-BBBB,500.00,2028-01-10\nEFZG-CCCC-DDDD,1234.50,2028-01-10\n",
    );
  });
});
