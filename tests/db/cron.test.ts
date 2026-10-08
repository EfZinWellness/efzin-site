import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaily, type DailyDeps } from "../../lib/cron/daily";
import { issueCredit } from "../../lib/credits/db";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { captureEmails, kinds, person, seedBooking, type Captured } from "./cronFixtures";
import { ORIGIN, world, type World } from "./webhookFixtures";

const ADMIN = "contact@efzinwellness.com";
/** 06:00 in Dubai on the given date (the daily cron's time). */
const at = (ymd: string) => new Date(`${ymd}T02:00:00Z`);

let w: World;
let sent: Captured[];
let restore: () => void;
let deps: DailyDeps;

beforeEach(async () => {
  w = await world();
  const c = captureEmails();
  sent = c.sent;
  restore = c.restore;
  deps = { stripe: w.stripe, sendEmail: c.send, origin: ORIGIN };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

/** A saved default card for the customer (as after Checkout). */
const savedCard = (customer: string) =>
  w.stripe.customerUpdates.push({ id: customer, params: { invoice_settings: { default_payment_method: `pm_${customer}` } } });

/** The schedule items Stripe invoices were created for. */
const chargedItems = () => w.stripe.invoicesCreated.map((i) => (i.params.metadata as Record<string, string> | undefined)?.item_id);

const status = async (table: string, id: string) =>
  (await w.db.query<{ status: string }>(`select status from ${table} where id = $1`, [id])).rows[0].status;

describe("daily job: scheduled payments", () => {
  it("charges exactly the items due today and reminds 3 days before; a second run does nothing", async () => {
    savedCard("cus_a");
    const a = await seedBooking(w.db, {
      slug: "test-retreat",
      status: "deposit_paid",
      booker: { name: "Amal A", email: "amal@x.com", customer: "cus_a", detailsComplete: true },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-03-10", amount: 96000, status: "scheduled" },
        { seq: 2, dueOn: "2027-03-13", amount: 96000, status: "scheduled" },
      ],
    });
    // Due today but the booking is cancelled.
    await seedBooking(w.db, {
      slug: "test-retreat",
      status: "cancelled",
      booker: { name: "Bea B", email: "bea@x.com", customer: "cus_b" },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-03-10", amount: 96000, status: "scheduled" },
        { seq: 2, dueOn: "2027-03-13", amount: 96000, status: "scheduled" },
      ],
    });
    // Due today but already paid.
    await seedBooking(w.db, {
      slug: "test-retreat",
      status: "deposit_paid",
      booker: { name: "Cy C", email: "cy@x.com", customer: "cus_c" },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-03-10", amount: 96000, status: "paid" },
        { seq: 2, dueOn: "2027-05-31", amount: 96000, status: "scheduled" },
      ],
    });

    await runDaily(w.db, at("2027-03-10"), deps);
    expect(chargedItems()).toEqual([a.itemIds[1]]);
    expect(w.stripe.invoicePaid).toEqual(["in_test_1"]);
    expect(kinds(sent)).toEqual(["scheduled_payment_upcoming>amal@x.com"]);
    expect(sent[0].text).toContain("€960");

    sent.length = 0;
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(w.stripe.invoicesCreated).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("an item that cannot be charged is reported to Tanya and the run goes on", async () => {
    savedCard("cus_a");
    savedCard("cus_d");
    const bad = await seedBooking(w.db, {
      slug: "test-retreat",
      status: "deposit_paid",
      booker: { name: "Amal A", email: "amal@x.com", customer: "cus_a", detailsComplete: true },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-03-10", amount: 192000, status: "scheduled", invoice: "in_bad" },
      ],
    });
    w.stripe.invoiceStatus.in_bad = "draft";
    w.stripe.invoiceTotal.in_bad = 5; // INVOICE_TOTAL_MISMATCH
    const good = await seedBooking(w.db, {
      slug: "test-retreat",
      status: "deposit_paid",
      booker: { name: "Dee D", email: "dee@x.com", customer: "cus_d", detailsComplete: true },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-03-10", amount: 192000, status: "scheduled" },
      ],
    });

    await runDaily(w.db, at("2027-03-10"), deps);
    expect(chargedItems()).toEqual([good.itemIds[1]]);
    expect(w.stripe.invoicePaid).toEqual(["in_test_1"]);
    expect(kinds(sent)).toEqual([`admin_error>${ADMIN}`]);
    expect(sent[0].text).toContain("INVOICE_TOTAL_MISMATCH");
    expect(sent[0].text).toContain(bad.itemIds[1]);
  });
});

describe("daily job: unpaid at the balance due date", () => {
  async function unpaid() {
    w.stripe.invoiceStatus.in_open = "open";
    return seedBooking(w.db, {
      slug: "test-retreat",
      status: "deposit_paid",
      booker: { name: "Amal A", email: "amal@x.com", customer: "cus_a", detailsComplete: true },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-05-31", amount: 192000, status: "failed", invoice: "in_open" },
      ],
    });
  }

  it("keeps the booking on the balance due date itself", async () => {
    const b = await unpaid();
    await runDaily(w.db, at("2027-05-31"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    expect(w.stripe.voided).toEqual([]);
  });

  it("cancels the booking the day after: items cancelled, invoices voided, nothing charged or refunded, booker and Tanya told", async () => {
    const b = await unpaid();
    const paid = await seedBooking(w.db, {
      slug: "test-retreat",
      status: "paid",
      booker: { name: "Bea B", email: "bea@x.com", detailsComplete: true },
      items: [{ seq: 0, dueOn: "2027-01-10", amount: 240000, status: "paid" }],
    });
    const spots = async () => (await w.db.query<{ n: number }>("select available_spots($1) as n", [b.ticketId])).rows[0].n;
    expect(await spots()).toBe(8);

    await runDaily(w.db, at("2027-06-01"), deps);
    const row = (
      await w.db.query<{ status: string; cancelled_by: string }>("select status, cancelled_by from bookings where id = $1", [b.bookingId])
    ).rows[0];
    expect(row).toEqual({ status: "cancelled", cancelled_by: "guest" });
    expect(await status("payment_schedule_items", b.itemIds[1])).toBe("cancelled");
    expect(await status("payment_schedule_items", b.itemIds[0])).toBe("paid");
    expect(await status("bookings", paid.bookingId)).toBe("paid");
    expect(w.stripe.voided).toEqual(["in_open"]);
    expect(w.stripe.invoicesCreated).toEqual([]);
    expect(w.stripe.invoicePaid).toEqual([]);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await spots()).toBe(9);
    expect(kinds(sent)).toEqual(["booking_cancelled_unpaid>amal@x.com", `booking_cancelled_unpaid>${ADMIN}`]);
    const guestMail = sent.find((s) => s.to === "amal@x.com")!;
    expect(guestMail.text).toContain("€1,920");
    expect(guestMail.text).toContain("No further payments will be taken");

    sent.length = 0;
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(sent).toEqual([]);
    expect(w.stripe.voided).toEqual(["in_open"]);
    expect(w.stripe.invoicesCreated).toEqual([]);
  });
});

describe("daily job: guest reminders", () => {
  async function eventBookings() {
    await seedBooking(w.db, {
      slug: "test-event",
      status: "paid",
      booker: { name: "Amal A", email: "amal@x.com" },
      guests: [{ name: "Sara S", email: "sara@x.com", detailsComplete: true }],
      items: [{ seq: 0, dueOn: "2027-01-10", amount: 56000, status: "paid" }],
    });
    await seedBooking(w.db, {
      slug: "test-event",
      status: "cancelled",
      booker: { name: "Cy C", email: "cy@x.com" },
      items: [{ seq: 0, dueOn: "2027-01-10", amount: 28000, status: "paid" }],
    });
  }

  it("details reminder 3 days before, only to guests with details missing, once", async () => {
    await eventBookings();
    await runDaily(w.db, at("2027-01-29"), deps);
    expect(kinds(sent)).toEqual(["details_reminder>amal@x.com"]);
    sent.length = 0;
    await runDaily(w.db, at("2027-01-29"), deps);
    expect(sent).toEqual([]);
  });

  it("day before to every guest of an active booking, day after likewise", async () => {
    await eventBookings();
    await runDaily(w.db, at("2027-01-31"), deps);
    expect(kinds(sent)).toEqual(["day_before>amal@x.com", "day_before>sara@x.com"]);
    expect(sent[0].text).toContain("Somewhere");
    sent.length = 0;
    await runDaily(w.db, at("2027-02-01"), deps);
    expect(sent).toEqual([]);
    await runDaily(w.db, at("2027-02-02"), deps);
    expect(kinds(sent)).toEqual(["day_after>amal@x.com", "day_after>sara@x.com"]);
  });
});

describe("daily job: credit and gift card expiry", () => {
  it("credit_expiring 30 days before, once; used or later credits are left alone", async () => {
    const p = await person(w.db, "Hana H", "hana@x.com");
    await issueCredit(w.db, p, 28000, null, new Date("2026-04-09T10:00:00Z"));
    await issueCredit(w.db, p, 15000, null, new Date("2026-05-20T10:00:00Z"));
    const used = await issueCredit(w.db, p, 9000, null, new Date("2026-04-09T10:00:00Z"));
    const b = await seedBooking(w.db, { slug: "test-event", status: "paid", booker: { name: "X", email: "xx@x.com" } });
    await w.db.query("update credits set redeemed_booking_id = $2 where id = $1", [used.id, b.bookingId]);

    await runDaily(w.db, at("2027-03-10"), deps);
    expect(kinds(sent)).toEqual(["credit_expiring>hana@x.com"]);
    expect(sent[0].text).toContain("AED 280");
    sent.length = 0;
    await runDaily(w.db, at("2027-03-11"), deps);
    expect(sent).toEqual([]);
  });

  it("gift_card_expiring to the holder 30 days before when value is left; expired cards are expired", async () => {
    const buyer = await person(w.db, "Mona M", "mona@x.com");
    const issue = async (ref: string, recipientEmail: string | null, activatedAt: string) => {
      const [c] = await issueGiftCards(w.db, {
        count: 1,
        initialAedMinor: 50000,
        buyerPersonId: buyer,
        recipient: { name: "Noor", email: recipientEmail },
        deliverOn: "2026-04-09",
        paymentRef: ref,
      });
      await activateGiftCards(w.db, ref, new Date(activatedAt));
      return c;
    };
    await issue("pi_1", "noor@x.com", "2026-04-09T10:00:00Z");
    const spent = await issue("pi_2", "zed@x.com", "2026-04-09T10:00:00Z");
    await w.db.query("select gift_card_ledger_add($1, null, -50000, 'redeem')", [spent.id]);
    const old = await issue("pi_3", "old@x.com", "2026-03-01T10:00:00Z");

    await runDaily(w.db, at("2027-03-10"), deps);
    expect(kinds(sent)).toEqual(["gift_card_expiring>noor@x.com"]);
    expect(sent[0].text).toContain("AED 500");
    expect(await status("gift_cards", old.id)).toBe("expired");
    sent.length = 0;
    await runDaily(w.db, at("2027-03-12"), deps);
    expect(sent).toEqual([]);
  });
});
