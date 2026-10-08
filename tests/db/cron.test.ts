import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../lib/content/sync";
import { runDaily, type DailyDeps } from "../../lib/cron/daily";
import { issueCredit } from "../../lib/credits/db";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { captureEmails, kinds, person, seedBooking, type Captured, type SeedItem } from "./cronFixtures";
import { ORIGIN, world, type World } from "./webhookFixtures";

const ADMIN = "contact@efzinwellness.com";
/** 06:00 in Dubai on the given date (the daily cron's time). */
const at = (ymd: string) => new Date(`${ymd}T02:00:00Z`);

let w: World;
let sent: Captured[];
let restore: () => void;
let fail: (on: boolean) => void;
let deps: DailyDeps;

beforeEach(async () => {
  w = await world();
  const c = captureEmails();
  sent = c.sent;
  restore = c.restore;
  fail = c.fail;
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

/** A part-paid retreat booking (deposit paid) with the given later items. */
const plan = (email: string, customer: string | undefined, later: SeedItem[]) =>
  seedBooking(w.db, {
    slug: "test-retreat",
    status: "deposit_paid",
    booker: { name: `${email[0].toUpperCase()} Guest`, email, ...(customer ? { customer } : {}), detailsComplete: true },
    items: [{ seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" }, ...later],
  });

describe("daily job: scheduled payments", () => {
  it("charges exactly the items due today and reminds 3 days before (with the card ending); a second run does nothing", async () => {
    savedCard("cus_a");
    const a = await plan("amal@x.com", "cus_a", [
      { seq: 1, dueOn: "2027-03-10", amount: 96000, status: "scheduled" },
      { seq: 2, dueOn: "2027-03-13", amount: 96000, status: "scheduled" },
    ]);
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
    await plan("cy@x.com", "cus_c", [
      { seq: 1, dueOn: "2027-03-10", amount: 96000, status: "paid" },
      { seq: 2, dueOn: "2027-05-31", amount: 96000, status: "scheduled" },
    ]);

    await runDaily(w.db, at("2027-03-10"), deps);
    expect(chargedItems()).toEqual([a.itemIds[1]]);
    expect(w.stripe.invoicePaid).toEqual(["in_test_1"]);
    expect(kinds(sent)).toEqual(["scheduled_payment_upcoming>amal@x.com"]);
    expect(sent[0].text).toContain("€960");
    expect(sent[0].text).toContain("ending 4242");

    sent.length = 0;
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(w.stripe.invoicesCreated).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("the upcoming-payment reminder leaves the card ending out when there is no saved card", async () => {
    await plan("dee@x.com", undefined, [{ seq: 1, dueOn: "2027-03-13", amount: 96000, status: "scheduled" }]);
    await runDaily(w.db, at("2027-03-10"), deps);
    expect(kinds(sent)).toEqual(["scheduled_payment_upcoming>dee@x.com"]);
    expect(sent[0].text).not.toContain("ending");
  });

  it("items that cannot be charged are reported to Tanya in one email per error code, and the run goes on", async () => {
    for (const c of ["cus_a", "cus_b", "cus_d"]) savedCard(c);
    const bad1 = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-03-10", amount: 192000, status: "scheduled", invoice: "in_bad1" }]);
    const bad2 = await plan("bea@x.com", "cus_b", [{ seq: 1, dueOn: "2027-03-10", amount: 192000, status: "scheduled", invoice: "in_bad2" }]);
    for (const id of ["in_bad1", "in_bad2"]) {
      w.stripe.invoiceStatus[id] = "draft";
      w.stripe.invoiceTotal[id] = 5; // INVOICE_TOTAL_MISMATCH
    }
    const good = await plan("dee@x.com", "cus_d", [{ seq: 1, dueOn: "2027-03-10", amount: 192000, status: "scheduled" }]);

    await runDaily(w.db, at("2027-03-10"), deps);
    expect(chargedItems()).toEqual([good.itemIds[1]]);
    expect(w.stripe.invoicePaid).toEqual(["in_test_1"]);
    expect(kinds(sent)).toEqual([`admin_error>${ADMIN}`]);
    expect(sent[0].text).toContain("INVOICE_TOTAL_MISMATCH");
    expect(sent[0].text).toContain(bad1.itemIds[1]);
    expect(sent[0].text).toContain(bad2.itemIds[1]);
  });

  it("when the cancel step fails, only items due today are charged (no late catch-up in that run)", async () => {
    savedCard("cus_a");
    savedCard("cus_b");
    const late = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-03-08", amount: 96000, status: "scheduled" }]);
    const today = await plan("bea@x.com", "cus_b", [{ seq: 1, dueOn: "2027-03-10", amount: 96000, status: "scheduled" }]);
    const broken: SqlClient = {
      query: async <T,>(sql: string, params?: unknown[]) => {
        if (sql.includes("having bool_and")) throw new Error("db hiccup");
        return w.db.query<T>(sql, params);
      },
    };
    await runDaily(broken, at("2027-03-10"), deps);
    expect(chargedItems()).toEqual([today.itemIds[1]]);
    await runDaily(w.db, at("2027-03-11"), deps);
    expect(chargedItems()).toEqual([today.itemIds[1], late.itemIds[1]]);
  });
});

describe("daily job: unpaid at the balance due date", () => {
  const spotsOf = async (ticketId: string) =>
    (await w.db.query<{ n: number }>("select available_spots($1) as n", [ticketId])).rows[0].n;

  /** The balance (due 31 May) was charged and failed; Stripe still retrying. */
  async function attemptedAndFailed() {
    w.stripe.invoiceStatus.in_open = "open";
    return plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-05-31", amount: 192000, status: "failed", invoice: "in_open" }]);
  }

  it("keeps the booking on the due date and the day after (grace for retries and pay links)", async () => {
    const b = await attemptedAndFailed();
    await runDaily(w.db, at("2027-05-31"), deps);
    await runDaily(w.db, at("2027-06-01"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    expect(w.stripe.voided).toEqual([]);
  });

  it("cancels two days after the last unpaid item: items cancelled, invoices voided, nothing charged or refunded, booker and Tanya told", async () => {
    const b = await attemptedAndFailed();
    const paid = await seedBooking(w.db, {
      slug: "test-retreat",
      status: "paid",
      booker: { name: "Bea B", email: "bea@x.com", detailsComplete: true },
      items: [{ seq: 0, dueOn: "2027-01-10", amount: 240000, status: "paid" }],
    });
    expect(await spotsOf(b.ticketId)).toBe(8);

    await runDaily(w.db, at("2027-06-02"), deps);
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
    expect(await spotsOf(b.ticketId)).toBe(9);
    expect(kinds(sent)).toEqual(["booking_cancelled_unpaid>amal@x.com", `booking_cancelled_unpaid>${ADMIN}`]);
    const guestMail = sent.find((s) => s.to === "amal@x.com")!;
    expect(guestMail.text).toContain("€1,920");
    expect(guestMail.text).toContain("31 May 2027");
    expect(guestMail.text).toContain("No further payments will be taken");

    sent.length = 0;
    await runDaily(w.db, at("2027-06-03"), deps);
    expect(sent).toEqual([]);
    expect(w.stripe.voided).toEqual(["in_open"]);
    expect(w.stripe.invoicesCreated).toEqual([]);
  });

  it("never cancels for an item Ef Zin never tried to collect (missed run): it is charged late instead", async () => {
    savedCard("cus_a");
    const b = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-05-31", amount: 192000, status: "scheduled" }]);
    await runDaily(w.db, at("2027-06-03"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    expect(chargedItems()).toEqual([b.itemIds[1]]);
    expect(w.stripe.invoicePaid).toEqual(["in_test_1"]);
    expect(sent.filter((s) => s.kind === "booking_cancelled_unpaid")).toEqual([]);
  });

  it("grace counts from the first charge attempt: missed on the due date, failed late on due+1, kept on due+2, cancelled on due+3", async () => {
    savedCard("cus_a");
    w.stripe.payError = Object.assign(new Error("declined"), { type: "StripeCardError" });
    const b = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-05-31", amount: 192000, status: "scheduled" }]);
    await runDaily(w.db, at("2027-06-01"), deps);
    expect(chargedItems()).toEqual([b.itemIds[1]]);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    await runDaily(w.db, at("2027-06-03"), deps);
    expect(await status("bookings", b.bookingId)).toBe("cancelled");
    expect(chargedItems()).toHaveLength(1);
  });

  const attemptedAt = async (itemId: string) =>
    (await w.db.query<{ t: string | null }>("select first_attempted_at::text as t from payment_schedule_items where id = $1", [itemId]))
      .rows[0].t;

  it("an invoice left unfinished by a Stripe 5xx on the due date is not an attempt: kept at due+2 and resumed by catch-up", async () => {
    savedCard("cus_a");
    const b = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-05-31", amount: 192000, status: "scheduled" }]);
    w.stripe.invoiceItemError = Object.assign(new Error("api down"), { type: "StripeAPIError", statusCode: 500 });
    await runDaily(w.db, at("2027-05-31"), deps);
    expect(w.stripe.invoiceStatus.in_test_1).toBe("draft");
    expect(await attemptedAt(b.itemIds[1])).toBeNull();

    await runDaily(w.db, at("2027-06-02"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    expect(w.stripe.invoicesCreated).toHaveLength(1);
    expect(w.stripe.invoicePaid).toEqual(["in_test_1"]);
    expect(await attemptedAt(b.itemIds[1])).not.toBeNull();
  });

  it("a pay link whose send failed is not an attempt: resumed and sent on the next run", async () => {
    const b = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-05-31", amount: 192000, status: "scheduled" }]);
    w.stripe.sendInvoiceError = Object.assign(new Error("api down"), { type: "StripeAPIError", statusCode: 503 });
    await runDaily(w.db, at("2027-05-31"), deps);
    expect(w.stripe.invoicesSent).toEqual([]);
    expect(await attemptedAt(b.itemIds[1])).toBeNull();

    await runDaily(w.db, at("2027-06-01"), deps);
    expect(w.stripe.invoicesSent.map((s) => s.id)).toEqual(["in_test_1"]);
    expect(await attemptedAt(b.itemIds[1])).not.toBeNull();
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    expect(w.stripe.invoicesCreated).toHaveLength(1);
  });

  it("a card decline on the due date is an attempt: cancelled at due+2", async () => {
    savedCard("cus_a");
    w.stripe.payError = Object.assign(new Error("declined"), { type: "StripeCardError" });
    const b = await plan("amal@x.com", "cus_a", [{ seq: 1, dueOn: "2027-05-31", amount: 192000, status: "scheduled" }]);
    await runDaily(w.db, at("2027-05-31"), deps);
    expect(await attemptedAt(b.itemIds[1])).not.toBeNull();
    await runDaily(w.db, at("2027-06-01"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(await status("bookings", b.bookingId)).toBe("cancelled");
    expect(w.stripe.invoicesCreated).toHaveLength(1);
  });

  it("an attempted item next to a never-attempted one blocks cancellation", async () => {
    const b = await plan("amal@x.com", "cus_a", [
      { seq: 1, dueOn: "2027-05-01", amount: 96000, status: "failed", invoice: "in_old" },
      { seq: 2, dueOn: "2027-05-31", amount: 96000, status: "scheduled" },
    ]);
    w.stripe.invoiceStatus.in_old = "open";
    await runDaily(w.db, at("2027-06-05"), { ...deps, stripe: null });
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
  });

  it("cancellations without the unpaid-balance reason are never mailed as unpaid", async () => {
    const b = await seedBooking(w.db, {
      slug: "test-retreat",
      status: "cancelled",
      booker: { name: "Amal A", email: "amal@x.com" },
      items: [
        { seq: 0, dueOn: "2027-01-10", amount: 48000, status: "paid" },
        { seq: 1, dueOn: "2027-05-31", amount: 192000, status: "cancelled" },
      ],
    });
    await w.db.query("update bookings set cancelled_by = 'guest', cancelled_at = $2 where id = $1", [b.bookingId, "2027-06-01T02:00:00Z"]);
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(sent.filter((s) => s.kind === "booking_cancelled_unpaid")).toEqual([]);
  });

  it("the booking's agreed schedule governs, not the experience date (experience moved earlier)", async () => {
    const b = await attemptedAndFailed();
    await w.db.query("update experiences set start_at = '2027-05-20T07:00:00Z' where slug = 'test-retreat'");
    await runDaily(w.db, at("2027-05-14"), deps);
    expect(await status("bookings", b.bookingId)).toBe("deposit_paid");
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(await status("bookings", b.bookingId)).toBe("cancelled");
  });

  it("a cancellation notice that failed to send is sent on the next run, exactly once", async () => {
    const b = await attemptedAndFailed();
    fail(true);
    await runDaily(w.db, at("2027-06-02"), deps);
    expect(await status("bookings", b.bookingId)).toBe("cancelled");
    expect(sent).toEqual([]);
    fail(false);
    await runDaily(w.db, at("2027-06-03"), deps);
    expect(kinds(sent)).toEqual(["booking_cancelled_unpaid>amal@x.com", `booking_cancelled_unpaid>${ADMIN}`]);
    await runDaily(w.db, at("2027-06-04"), deps);
    expect(sent.filter((s) => s.to === "amal@x.com")).toHaveLength(1);
  });
});

describe("daily job: guest reminders", () => {
  async function eventBookings() {
    await seedBooking(w.db, {
      slug: "test-event",
      status: "paid",
      booker: { name: "Amal A", email: "amal@x.com", checkedIn: true },
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

  it("day before to every guest of an active booking, with venue, address, map and timing from the content", async () => {
    await eventBookings();
    const info = vi.fn().mockResolvedValue({
      venue: { name: "Somewhere", address: "Alserkal Avenue, Dubai", mapUrl: "https://maps.test/x" },
      schedule: [{ time: "10:00", label: "Arrival and tea" }],
    });
    await runDaily(w.db, at("2027-01-31"), { ...deps, experienceInfo: info });
    expect(kinds(sent)).toEqual(["day_before>amal@x.com", "day_before>sara@x.com"]);
    expect(info).toHaveBeenCalledWith("test-event");
    for (const t of ["Somewhere", "Alserkal Avenue, Dubai", "https://maps.test/x", "10:00 Arrival and tea"]) expect(sent[0].text).toContain(t);
    sent.length = 0;
    await runDaily(w.db, at("2027-02-01"), deps);
    expect(sent).toEqual([]);
  });

  it("day after only to checked-in attendees, with the review link", async () => {
    await eventBookings();
    await runDaily(w.db, at("2027-02-02"), deps);
    expect(kinds(sent)).toEqual(["day_after>amal@x.com"]);
    expect(sent[0].text).toContain("Leave a review");
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
