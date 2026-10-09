import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEmail } from "../../lib/email/render";
import type { EmailKind } from "../../lib/email/send";
import { buildIcs } from "../../lib/email/ics";
import { cancelOptions } from "../../lib/policy/options";
import { GET as dailyGet } from "../../app/api/cron/daily/route";
import { GET as hourlyGet } from "../../app/api/cron/hourly/route";
import { GET as giftGet } from "../../app/api/cron/gift-delivery/route";

const ORIGIN = "https://efzin.test";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_ORIGIN;
  delete process.env.CRON_SECRET;
  delete process.env.DATABASE_URL;
});

/** Each kind with realistic data (the shapes callers send) and copy that must appear. */
const CASES: [EmailKind, Record<string, unknown>, { subject: string; text: string[] }][] = [
  [
    "booking_confirmed",
    {
      name: "Layla Haddad",
      experience: "Greek Retreat",
      startsAt: "2027-06-10T07:00:00.000Z",
      timezone: "Europe/Athens",
      venue: "Villa Elia",
      bookingId: "0a1b2c3d-0000-0000-0000-000000000000",
      paymentOption: "instalments",
      amountPaidMinor: 48000,
      currency: "EUR",
      schedule: [
        { seq: 0, dueOn: "2027-01-10", amountMinor: 48000, currency: "EUR", status: "paid" },
        { seq: 1, dueOn: "2027-02-10", amountMinor: 96000, currency: "EUR", status: "scheduled" },
        { seq: 2, dueOn: "2027-03-10", amountMinor: 96000, currency: "EUR", status: "scheduled" },
      ],
      guests: ["Sara Khan"],
      claimLink: `${ORIGIN}/claim`,
      detailsLink: `${ORIGIN}/account`,
      policy: ["Within 30 days of arrival: no refund; you may transfer your place to another person."],
      calendar: true,
    },
    {
      subject: "You're booked: Greek Retreat",
      text: [
        "Dear Layla,",
        "Thursday 10 June 2027, 10:00",
        "Villa Elia",
        "Sara Khan",
        "Your payment schedule",
        "10 Feb 2027",
        "€960",
        "Ef Zin will charge your saved card on these dates",
        "Cancellation policy",
        "Within 30 days of arrival: no refund",
        "A calendar invite is attached.",
        "Add my details",
      ],
    },
  ],
  [
    "guest_added",
    { name: "Sara Khan", bookerName: "Layla Haddad", experience: "Sound Bath", startsAt: "2027-02-01T06:00:00.000Z", claimLink: `${ORIGIN}/c` },
    { subject: "Layla Haddad booked you a spot at Sound Bath", text: ["Dear Sara,", "Layla Haddad has booked you a place", "Monday 1 February 2027, 10:00"] },
  ],
  [
    "details_reminder",
    { name: "Sara", experience: "Sound Bath", startsAt: "2027-02-01T06:00:00.000Z", timezone: "Asia/Dubai", detailsLink: `${ORIGIN}/account` },
    { subject: "A few details before Sound Bath", text: ["health details", "Add my details"] },
  ],
  [
    "day_before",
    { name: "Sara", experience: "Sound Bath", startsAt: "2027-02-01T06:00:00.000Z", timezone: "Asia/Dubai", venue: "Alserkal", experienceUrl: `${ORIGIN}/events/x` },
    { subject: "See you tomorrow: Sound Bath", text: ["Alserkal", "Monday 1 February 2027, 10:00", "parking"] },
  ],
  [
    "day_after",
    { name: "Sara", experience: "Sound Bath", nextTitle: "Breathwork", nextUrl: `${ORIGIN}/events/breath` },
    { subject: "Thank you for joining Sound Bath", text: ["Thank you for joining us", "Next up: Breathwork"] },
  ],
  ["abandoned_checkout", { name: "Layla", experience: "Sound Bath", link: `${ORIGIN}/book/x` }, { subject: "Your spot is still waiting", text: ["Finish booking"] }],
  ["waitlist_open", { name: "Layla", experience: "Sound Bath", link: `${ORIGIN}/book/x` }, { subject: "A spot has opened: Sound Bath", text: ["first"] }],
  ["balance_reminder", { name: "Layla", experience: "Retreat", amountMinor: 192000, currency: "EUR", dueOn: "2027-05-31" }, { subject: "Your balance for Retreat", text: ["€1,920", "31 May 2027"] }],
  [
    "credit_expiring",
    { name: "Layla", code: "EFZ-ABCDEF", amountAedMinor: 28000, expiresOn: "2027-04-09" },
    { subject: "Your Ef Zin credit expires on 9 Apr 2027", text: ["EFZ-ABCDEF", "AED 280"] },
  ],
  ["admin_new_booking", { experience: "Sound Bath", booker: "Layla <l@x.com>", guests: 2, spotsRemaining: "whole: 3" }, { subject: "New booking: Sound Bath", text: ["whole: 3"] }],
  ["request_received", { type: "private", name: "Omar", email: "o@x.com" }, { subject: "New private enquiry from Omar", text: ["o@x.com"] }],
  ["admin_error", { context: "daily_charge", problem: "A payment could not be charged.", itemId: "i1" }, { subject: "Ef Zin alert: daily charge", text: ["A payment could not be charged.", "i1"] }],
  [
    "scheduled_payment_upcoming",
    { name: "Layla", experience: "Retreat", amountMinor: 96000, currency: "EUR", dueOn: "2027-03-13", payRestUrl: `${ORIGIN}/account/bookings/b1`, updateCardUrl: `${ORIGIN}/account/bookings/b1` },
    { subject: "Payment coming up for Retreat", text: ["€960", "13 Mar 2027", "Pay the rest now", "Update card"] },
  ],
  [
    "scheduled_payment_receipt",
    { name: "Layla", experience: "Retreat", amountMinor: 96000, currency: "EUR", remainingMinor: 96000, bookingId: "b1" },
    { subject: "Payment received: Retreat", text: ["€960", "Still to pay"] },
  ],
  [
    "scheduled_payment_failed",
    { name: "Layla", experience: "Retreat", amountMinor: 96000, currency: "EUR", payUrl: "https://invoice.stripe.test/i/1", updateCardUrl: `${ORIGIN}/account`, balanceDueOn: "2027-05-31" },
    { subject: "Your payment for Retreat didn't go through", text: ["€960", "31 May 2027", "cancelled", "Pay now"] },
  ],
  [
    "admin_payment_failed",
    { experience: "Retreat", booker: "Layla <l@x.com>", amountMinor: 96000, currency: "EUR", attempts: 2, balanceDueOn: "2027-05-31" },
    { subject: "Payment failed: Retreat", text: ["Layla <l@x.com>", "€960"] },
  ],
  [
    "gift_card_bought",
    { buyerName: "Mona", value: "AED 500", recipientLabel: "Noor", deliverOn: "1 February 2027", codeMasked: "EFZG-••••-BBBB" },
    { subject: "Thank you for your Ef Zin gift card purchase", text: ["Noor", "1 February 2027", "EFZG-••••-BBBB"] },
  ],
  [
    "gift_card_bought",
    { buyerName: "Mona", value: "AED 250", expiresOn: "2028-01-10", codes: ["EFZG-AAAA-BBBB", "EFZG-CCCC-DDDD"], bookUrl: `${ORIGIN}/events` },
    { subject: "Your Ef Zin gift cards (2)", text: ["EFZG-AAAA-BBBB", "EFZG-CCCC-DDDD", "CSV"] },
  ],
  [
    "gift_card_delivered",
    { recipientName: "Noor", buyerName: "Mona", message: "Enjoy!", code: "EFZG-AAAA-BBBB", value: "AED 500", expiresOn: "2028-01-10", bookUrl: `${ORIGIN}/events`, hasPdf: true },
    { subject: "Mona sent you an Ef Zin gift card", text: ["Dear Noor,", "Enjoy!", "EFZG-AAAA-BBBB", "AED 500", "Book with your gift", "printable card is attached"] },
  ],
  [
    "gift_card_delivered_buyer",
    { buyerName: "Mona", recipientName: "Noor", value: "AED 500" },
    { subject: "Your Ef Zin gift has been delivered", text: ["Noor has been emailed their AED 500"] },
  ],
  [
    "gift_card_used",
    { name: "Noor", experience: "Sound Bath", amountUsedAedMinor: 28000, balanceAedMinor: 22000, codeMasked: "EFZG-••••-BBBB" },
    { subject: "You used your Ef Zin gift card", text: ["AED 280", "AED 220", "Sound Bath"] },
  ],
  [
    "gift_card_expiring",
    { name: "Noor", code: "EFZG-AAAA-BBBB", balanceAedMinor: 22000, expiresOn: "2027-04-09", upcoming: [{ title: "Breathwork", url: `${ORIGIN}/events/b` }] },
    { subject: "Your Ef Zin gift card expires on 9 Apr 2027", text: ["AED 220", "EFZG-AAAA-BBBB", "Breathwork"] },
  ],
  [
    "booking_cancelled_unpaid",
    { name: "Layla", experience: "Retreat", unpaidMinor: 192000, currency: "EUR", balanceDueOn: "2027-05-31", refundMinor: 0 },
    { subject: "Your booking for Retreat has been cancelled", text: ["€1,920", "31 May 2027", "No further payments will be taken"] },
  ],
  [
    "booking_cancelled_unpaid",
    { forAdmin: true, experience: "Retreat", booker: "Layla <l@x.com>", unpaidMinor: 192000, currency: "EUR", bookingId: "b1" },
    { subject: "Booking cancelled (balance unpaid): Retreat", text: ["Layla <l@x.com>", "b1"] },
  ],
  [
    "booking_cancelled",
    {
      name: "Layla",
      experience: "Retreat",
      cardRefunds: [
        { amountMinor: 46500, currency: "EUR" },
        { amountMinor: 17400, currency: "EUR" },
      ],
      feesDeductedMinor: 2100,
      giftCardAed: 120000,
      creditAed: 0,
    },
    { subject: "Your booking for Retreat is cancelled", text: ["€465 + €174", "AED 1,200", "No further payments", "processing fees"] },
  ],
  [
    "booking_cancelled",
    { name: "Layla", experience: "Sound Bath", creditAed: 28000, creditCode: "EFZ-ABCDEF", creditExpiresOn: "2028-01-29" },
    { subject: "Your booking for Sound Bath is cancelled", text: ["AED 280", "EFZ-ABCDEF", "29 Jan 2028"] },
  ],
  [
    "booking_cancelled",
    { name: "Layla", experience: "Sound Bath", byEfzin: true, cardRefunds: [{ amountMinor: 28000, currency: "AED" }] },
    { subject: "Sound Bath has been cancelled", text: ["full refund", "no fees deducted", "AED 280", "future experience"] },
  ],
  [
    "booking_transferred",
    { name: "Sara", experience: "Sound Bath", newGuestName: "Nour N", startsAt: "2027-02-01T06:00:00.000Z" },
    { subject: "Your place at Sound Bath has been transferred", text: ["to Nour N", "1 February 2027"] },
  ],
];

describe("email templates", () => {
  it.each(CASES.map((c, i) => [`${c[0]} #${i}`, ...c] as const))("%s renders its key copy", async (_, kind, data, want) => {
    process.env.NEXT_PUBLIC_SITE_ORIGIN = ORIGIN;
    const r = await renderEmail(kind, data);
    expect(r.subject).toBe(want.subject);
    for (const t of want.text) expect(r.text).toContain(t);
    // Branded: the wordmark from the site, ivory page, navy text.
    expect(r.html).toContain(`${ORIGIN}/brand/wordmark-navy.png`);
    expect(r.html).toMatch(/#FFFDF1/i);
    expect(r.html).toMatch(/#1A405A/i);
    expect(r.text).not.toContain("wordmark");
  });

  it("covers every kind with a template, even with no data", async () => {
    const kinds = new Set(CASES.map((c) => c[0]));
    expect(kinds.size).toBe(24);
    for (const k of kinds) {
      const r = await renderEmail(k, {});
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.html).toContain("wordmark-navy.png");
    }
  });

  it("escapes user-provided text", async () => {
    const r = await renderEmail("gift_card_delivered", { recipientName: "<b>x</b>", message: '<script>alert("x")</script>', code: "C" });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("keeps subjects on one line", async () => {
    const r = await renderEmail("guest_added", { bookerName: "Evil\r\nBcc: x@y.com", experience: "X" });
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it("never links to non-http URLs", async () => {
    const r = await renderEmail("abandoned_checkout", { link: "javascript:alert(1)" });
    expect(r.html).not.toContain("javascript:");
  });

  it("booking_confirmed tells pay-by-link guests they'll get a secure link for each instalment", async () => {
    const schedule = [
      { seq: 0, dueOn: "2027-01-10", amountMinor: 48000, currency: "EUR", status: "paid" },
      { seq: 1, dueOn: "2027-05-31", amountMinor: 192000, currency: "EUR", status: "scheduled" },
    ];
    const link = await renderEmail("booking_confirmed", { experience: "R", schedule, payByLink: true });
    expect(link.text).toContain("We'll email you a secure link to pay each instalment.");
    expect(link.text).not.toContain("charge your saved card");
    const card = await renderEmail("booking_confirmed", { experience: "R", schedule, payByLink: false });
    expect(card.text).toContain("Ef Zin will charge your saved card on these dates");
  });

  it("scheduled_payment_upcoming shows the card ending only when known", async () => {
    const base = { experience: "R", amountMinor: 96000, currency: "EUR", dueOn: "2027-03-13" };
    expect((await renderEmail("scheduled_payment_upcoming", { ...base, cardLast4: "4242" })).text).toContain("ending 4242");
    expect((await renderEmail("scheduled_payment_upcoming", base)).text).not.toContain("ending");
  });

  it("day_before has the address, map link and timing when given", async () => {
    const r = await renderEmail("day_before", {
      experience: "Sound Bath",
      venue: "Alserkal",
      address: "Alserkal Avenue, Dubai",
      mapUrl: "https://maps.test/x",
      timings: ["10:00 Arrival", "10:30 Sound bath"],
    });
    for (const t of ["Alserkal Avenue, Dubai", "https://maps.test/x", "10:00 Arrival", "10:30 Sound bath"]) expect(r.text).toContain(t);
  });

  it("day_after links to the review page", async () => {
    const { REVIEW_URL } = await import("../../lib/site");
    const r = await renderEmail("day_after", { name: "Sara", experience: "Sound Bath" });
    expect(r.text).toContain("Leave a review");
    expect(r.html).toContain(REVIEW_URL);
  });

  it("mentions the printable card only when a PDF is attached", async () => {
    const without = await renderEmail("gift_card_delivered", { recipientName: "Noor", code: "C", hasPdf: false });
    expect(without.text).not.toContain("printable");
    expect(without.html).not.toContain("printable");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "booking-b1@efzinwellness.com",
    title: "Sound Bath; with Tanya, Dubai",
    startsAt: "2027-02-01T10:00:00+04:00",
    endsAt: "2027-02-01T12:00:00+04:00",
    location: "Alserkal Avenue, Dubai",
    url: `${ORIGIN}/events/sound-bath`,
    now: new Date("2027-01-10T09:00:00Z"),
  });

  it("writes start and end in UTC", () => {
    expect(ics).toContain("DTSTART:20270201T060000Z");
    expect(ics).toContain("DTEND:20270201T080000Z");
    expect(ics).toContain("DTSTAMP:20270110T090000Z");
  });

  it("is a valid calendar with CRLF lines and escaped text", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:booking-b1@efzinwellness.com");
    expect(ics).toContain("SUMMARY:Sound Bath\\; with Tanya\\, Dubai");
    expect(ics).toContain("LOCATION:Alserkal Avenue\\, Dubai");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});

describe("balance-due cancellation policy", () => {
  it("a standard retreat cancelled at its balance due date (10 days before) returns nothing", () => {
    const opts = cancelOptions({
      template: "standard_retreat",
      startsAt: new Date("2027-06-10T07:00:00Z"),
      now: new Date("2027-06-01T02:00:00Z"),
      amountPaidBaseMinor: 48000,
      totalPriceBaseMinor: 240000,
      amountPaidAedMinor: 190000,
      cancelledBy: "guest",
    });
    expect(opts.filter((o) => o.kind === "refund" || o.kind === "credit")).toEqual([]);
  });
});

describe("cron routes", () => {
  const routes = [
    ["daily", dailyGet],
    ["hourly", hourlyGet],
    ["gift-delivery", giftGet],
  ] as const;

  it.each(routes)("%s answers 401 without the right bearer token", async (name, GET) => {
    process.env.CRON_SECRET = "s3cret";
    const url = `${ORIGIN}/api/cron/${name}`;
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await GET(new Request(url, { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await GET(new Request(url, { headers: { authorization: "s3cret" } }))).status).toBe(401);
  });

  it.each(routes)("%s refuses everything when CRON_SECRET is not set", async (name, GET) => {
    const res = await GET(new Request(`${ORIGIN}/api/cron/${name}`, { headers: { authorization: "Bearer undefined" } }));
    expect(res.status).toBe(401);
  });

  it.each(routes)("%s answers 503 when authorised but no database is configured", async (name, GET) => {
    process.env.CRON_SECRET = "s3cret";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new Request(`${ORIGIN}/api/cron/${name}`, { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(503);
  });
});
