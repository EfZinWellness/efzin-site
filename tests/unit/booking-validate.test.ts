import { describe, it, expect } from "vitest";
import { ExperienceSchema, type Experience } from "../../lib/content/schema";
import { validateBooking } from "../../lib/booking/validate";
import { bookingTotal, paymentOptionsFor, scheduleFor } from "../../lib/booking/quote";

function retreat(over: Record<string, unknown> = {}): Experience {
  return ExperienceSchema.parse({
    slug: "test-retreat",
    type: "retreat",
    title: "Test Retreat",
    startsAt: "2027-06-10T10:00:00+03:00",
    endsAt: "2027-06-14T16:00:00+03:00",
    timezone: "Europe/Athens",
    venue: { name: "Greece" },
    pillars: ["move"],
    status: "on_sale",
    baseCurrency: "EUR",
    policy: "standard_retreat",
    heroImage: "/images/x.jpg",
    summary: "s",
    totalPriceMinor: 240000,
    tickets: [
      { key: "shared", name: "Shared room", priceMinor: 240000, capacity: 10 },
      { key: "private", name: "Private room", priceMinor: 300000, capacity: 4 },
    ],
    ...over,
  });
}

const NOW = new Date("2027-01-10T09:00:00Z");

function req(over: Record<string, unknown> = {}) {
  return {
    slug: "test-retreat",
    lines: [{ ticketKey: "shared", qty: 2 }],
    booker: { name: "Layla Haddad", email: "Layla@Email.com", phone: "+971500000000" },
    guests: [{ name: "Sara Nassar", email: "sara@email.com", ticketKey: "shared" }],
    paymentOption: "full",
    policyAccepted: true,
    ...over,
  };
}

const fail = (r: ReturnType<typeof validateBooking>): string[] => (r.ok ? [] : r.errors);

describe("validateBooking", () => {
  it("accepts a valid request and lowercases emails", () => {
    const r = validateBooking(req({ guests: [{ name: "Sara", email: "SARA@email.com", ticketKey: "shared" }] }), retreat(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.booker.email).toBe("layla@email.com");
    expect(r.value.guests[0].email).toBe("sara@email.com");
  });

  it("rejects duplicate guest emails", () => {
    const sameAsBooker = validateBooking(
      req({ guests: [{ name: "Me again", email: "layla@EMAIL.com", ticketKey: "shared" }] }),
      retreat(),
      NOW,
    );
    expect(fail(sameAsBooker).join(" ")).toMatch(/same email/i);

    const twoFriends = validateBooking(
      req({
        lines: [{ ticketKey: "shared", qty: 3 }],
        guests: [
          { name: "Sara", email: "sara@email.com", ticketKey: "shared" },
          { name: "Sara 2", email: "Sara@email.com", ticketKey: "shared" },
        ],
      }),
      retreat(),
      NOW,
    );
    expect(fail(twoFriends).join(" ")).toMatch(/same email/i);
  });

  it("rejects an ended experience and one that is not on sale; sold_out content is accepted (the hold enforces capacity)", () => {
    expect(fail(validateBooking(req(), retreat(), new Date("2027-06-15T00:00:00Z"))).join(" ")).toMatch(/not available/i);
    expect(fail(validateBooking(req(), retreat({ status: "interest" }), NOW)).join(" ")).toMatch(/not available/i);
    expect(validateBooking(req(), retreat({ status: "sold_out" }), NOW).ok).toBe(true);
  });

  it("rejects instalments when they are not available", () => {
    const late = new Date("2027-04-25T09:00:00Z");
    expect(paymentOptionsFor(retreat(), late)).toEqual(["full", "deposit_balance"]);
    const r = validateBooking(req({ paymentOption: "instalments", scheduleConsent: true }), retreat(), late);
    expect(fail(r).join(" ")).toMatch(/payment option/i);
    const events = validateBooking(
      req({ paymentOption: "deposit_balance", scheduleConsent: true }),
      retreat({ paymentOptions: ["full"] }),
      NOW,
    );
    expect(events.ok).toBe(false);
  });

  it("requires schedule consent for deposit options", () => {
    const r = validateBooking(req({ paymentOption: "deposit_balance" }), retreat(), NOW);
    expect(fail(r).join(" ")).toMatch(/charge this card/i);
    expect(validateBooking(req({ paymentOption: "deposit_balance", scheduleConsent: true }), retreat(), NOW).ok).toBe(true);
  });

  it("requires the policy, a matching number of guests, known tickets and an empty honeypot", () => {
    expect(validateBooking(req({ policyAccepted: false }), retreat(), NOW).ok).toBe(false);
    expect(fail(validateBooking(req({ guests: [] }), retreat(), NOW)).join(" ")).toMatch(/guest/i);
    expect(
      fail(validateBooking(req({ lines: [{ ticketKey: "suite", qty: 2 }] }), retreat(), NOW)).join(" "),
    ).toMatch(/ticket/i);
    expect(
      validateBooking(
        req({ guests: [{ name: "Sara", email: "sara@email.com", ticketKey: "private" }] }),
        retreat(),
        NOW,
      ).ok,
    ).toBe(false);
    expect(validateBooking(req({ website: "spam.example" }), retreat(), NOW).ok).toBe(false);
  });
});

describe("quote", () => {
  it("totals ticket prices and builds the deposit schedule", () => {
    const e = retreat();
    const total = bookingTotal(e, [{ ticketKey: "shared", qty: 1 }]);
    expect(total).toBe(240000);
    const s = scheduleFor(e, total, "instalments", NOW);
    expect(s.map((i) => i.amountMinor)).toEqual([48000, 48000, 48000, 48000, 48000]);
    expect(s[0].dueOn).toBe("2027-01-10");
  });
});
