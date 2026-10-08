import { describe, it, expect, beforeEach } from "vitest";
import {
  NOW,
  RETREAT,
  EVENT,
  checkout,
  completedBooking,
  world,
  planBooking,
  type World,
} from "./webhookFixtures";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { issueCredit } from "../../lib/credits/db";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { loadBooking, loadBookings, pendingGuests } from "../../lib/account/bookings";
import { loadCredits } from "../../lib/account/credits";
import { loadGiftCards } from "../../lib/account/giftCards";
import { loadHealth, saveHealth } from "../../lib/account/health";
import { requestDeletion } from "../../lib/account/deletion";
import { loadProfile, saveProfile } from "../../lib/account/profile";
import { resendGiftCard, resetGiftResendThrottleForTests } from "../../lib/account/giftResend";
import { bookingStatusBySession } from "../../lib/account/confirmed";

let w: World;

const person = async (name: string, email: string) =>
  (await w.db.query<{ id: string }>("insert into people (name, email) values ($1, $2) returning id", [name, email])).rows[0]
    .id;
const idOf = async (email: string) =>
  (await w.db.query<{ id: string }>("select id from people where email = $1", [email])).rows[0].id;

/** Layla books the retreat on a plan for herself and Sara. */
async function retreatWithGuest() {
  const { pendingId, sessionId } = await checkout(w, RETREAT, {
    lines: [{ ticketKey: "shared", qty: 2 }],
    guests: [{ name: "Sara Khan", email: "sara@email.com", ticketKey: "shared" }],
    paymentOption: "deposit_balance",
    scheduleConsent: true,
  });
  await handleStripeEvent(completedBooking("evt_r", pendingId, sessionId, { customer: "cus_test_1" }), w.deps);
  const bookingId = (await w.db.query<{ id: string }>("select id from bookings")).rows[0].id;
  w.emails.length = 0;
  return { bookingId, sessionId, layla: await idOf("layla@email.com"), sara: await idOf("sara@email.com") };
}

beforeEach(async () => {
  w = await world();
  resetGiftResendThrottleForTests();
});

describe("loadBookings", () => {
  it("gives the booker the booking with its schedule and pending guests", async () => {
    const { bookingId, layla } = await retreatWithGuest();
    const { upcoming, past } = await loadBookings(w.db, layla, NOW);
    expect(past).toEqual([]);
    expect(upcoming).toHaveLength(1);
    const b = upcoming[0];
    expect(b).toMatchObject({ id: bookingId, title: "Test Retreat", status: "deposit_paid", isBooker: true });
    expect(b.schedule.map((i) => i.status)).toEqual(["paid", "scheduled"]);
    expect(b.schedule.every((i) => i.currency === "EUR")).toBe(true);
    expect(b.schedule[1].dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.guests).toEqual([
      { name: "Layla Haddad", detailsComplete: false, isBooker: true },
      { name: "Sara Khan", detailsComplete: false, isBooker: false },
    ]);
    expect(pendingGuests(upcoming)).toEqual([{ bookingId, title: "Test Retreat", name: "Sara Khan" }]);
  });

  it("shows a guest the booking but not the schedule or the other guests", async () => {
    const { bookingId, sara } = await retreatWithGuest();
    const { upcoming } = await loadBookings(w.db, sara, NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ id: bookingId, isBooker: false, schedule: [], guests: [] });
    expect(pendingGuests(upcoming)).toEqual([]);
  });

  it("shows nothing to an unrelated person, and loadBooking refuses them", async () => {
    const { bookingId } = await retreatWithGuest();
    const x = await person("X", "x@example.com");
    expect(await loadBookings(w.db, x, NOW)).toEqual({ upcoming: [], past: [] });
    expect(await loadBooking(w.db, x, bookingId)).toBeNull();
    expect(await loadBooking(w.db, x, "not-a-uuid")).toBeNull();
  });

  it("puts finished and cancelled bookings under past", async () => {
    const { bookingId, layla } = await retreatWithGuest();
    const later = new Date("2027-07-01T00:00:00Z");
    expect((await loadBookings(w.db, layla, later)).past.map((b) => b.id)).toEqual([bookingId]);
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    const now = await loadBookings(w.db, layla, NOW);
    expect(now.upcoming).toEqual([]);
    expect(now.past[0]).toMatchObject({ id: bookingId, status: "cancelled" });
  });

  it("loadBooking returns the booker's view with schedule", async () => {
    const { bookingId, layla } = await planBooking(w).then(async (r) => ({ ...r, layla: await idOf("layla@email.com") }));
    const b = await loadBooking(w.db, layla, bookingId);
    expect(b?.isBooker).toBe(true);
    expect(b?.schedule.length).toBe(2);
  });
});

describe("loadCredits", () => {
  it("lists usable credits with a total, and nothing redeemed, expired or someone else's", async () => {
    const me = await person("Me", "me@example.com");
    const other = await person("O", "o@example.com");
    const a = await issueCredit(w.db, me, 30000, null, NOW);
    await issueCredit(w.db, me, 10000, null, NOW);
    await issueCredit(w.db, other, 99900, null, NOW);
    const redeemed = await issueCredit(w.db, me, 5000, null, NOW);
    const { bookingId } = await planBooking(w);
    await w.db.query("update credits set redeemed_booking_id = $2 where code = $1", [redeemed.code, bookingId]);
    const expired = await issueCredit(w.db, me, 7000, null, NOW);
    await w.db.query("update credits set expires_at = $2 where code = $1", [expired.code, "2027-01-01T00:00:00Z"]);

    const c = await loadCredits(w.db, me, NOW);
    expect(c.totalAedMinor).toBe(40000);
    expect(c.credits.map((x) => x.amountAedMinor).sort()).toEqual([10000, 30000]);
    expect(c.credits.find((x) => x.amountAedMinor === 30000)?.code).toBe(a.code);
    expect(c.credits[0].expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe("loadGiftCards", () => {
  it("shows cards bought and received with balances", async () => {
    const me = await person("Mona", "mona@example.com");
    const friend = await person("Fadi", "fadi@example.com");
    // Bought by me for Noor.
    await issueGiftCards(w.db, {
      count: 1,
      initialAedMinor: 50000,
      buyerPersonId: me,
      recipient: { name: "Noor", email: "noor@example.com" },
      deliverOn: "2027-01-10",
      paymentRef: "pi_a",
    });
    // Bought by Fadi for me (matched by email).
    await issueGiftCards(w.db, {
      count: 1,
      initialAedMinor: 20000,
      buyerPersonId: friend,
      recipient: { name: "Mona", email: "MONA@example.com" },
      deliverOn: "2027-01-10",
      paymentRef: "pi_b",
    });
    // Fadi's own card: not mine. A pending (unpaid) card: hidden.
    await issueGiftCards(w.db, { count: 1, initialAedMinor: 10000, buyerPersonId: friend, deliverOn: "2027-01-10", paymentRef: "pi_c" });
    await issueGiftCards(w.db, { count: 1, initialAedMinor: 10000, buyerPersonId: me, deliverOn: "2027-01-10", paymentRef: "pi_d" });
    for (const pi of ["pi_a", "pi_b", "pi_c"]) await activateGiftCards(w.db, pi, NOW);
    const b = (await w.db.query<{ id: string }>("select id from gift_cards where stripe_payment_intent = 'pi_b'")).rows[0].id;
    await w.db.query("select gift_card_ledger_add($1, null, -5000, 'redeem')", [b]);

    const g = await loadGiftCards(w.db, me);
    expect(g.bought).toHaveLength(1);
    expect(g.bought[0]).toMatchObject({ balanceAedMinor: 50000, initialAedMinor: 50000, status: "active", recipientLabel: "Noor" });
    // A card bought for someone else shows masked.
    expect(g.bought[0].code).toMatch(/^EFZG-••••-/);
    expect(g.received).toHaveLength(1);
    expect(g.received[0]).toMatchObject({ balanceAedMinor: 15000, initialAedMinor: 20000, fromName: "Fadi" });
    expect(g.received[0].code).toMatch(/^EFZG-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

describe("health and waiver", () => {
  it("refuses to save health details without explicit consent", async () => {
    const { layla } = await retreatWithGuest();
    const r = await saveHealth(w.db, layla, { conditions: "Asthma", waiver: true }, NOW);
    expect(r.ok).toBe(false);
    expect((await w.db.query("select * from health_profiles")).rows).toEqual([]);
    expect((await w.db.query("select * from waivers")).rows).toEqual([]);
  });

  it("saves consent and the v1 waiver, then marks upcoming bookings complete for that person only", async () => {
    const { layla, bookingId } = await retreatWithGuest();
    const r = await saveHealth(
      w.db,
      layla,
      { conditions: "Asthma", injuries: "", pregnancy: false, allergies: "Nuts", dietary: "Vegetarian", consent: true, waiver: true },
      NOW,
    );
    expect(r).toEqual({ ok: true, complete: true });
    const h = await loadHealth(w.db, layla);
    expect(h.profile).toMatchObject({ conditions: "Asthma", allergies: "Nuts", dietary: "Vegetarian", pregnancy: false });
    expect(h.profile?.consentAt).toBeTruthy();
    expect(h.waiverAcceptedAt).toBeTruthy();
    const w1 = await w.db.query<{ version: string }>("select version from waivers where person_id = $1", [layla]);
    expect(w1.rows).toEqual([{ version: "v1" }]);
    const g = await w.db.query<{ name: string; details_complete: boolean }>(
      `select p.name, g.details_complete from booking_guests g join people p on p.id = g.person_id
        where g.booking_id = $1 order by p.name`,
      [bookingId],
    );
    expect(g.rows).toEqual([
      { name: "Layla Haddad", details_complete: true },
      { name: "Sara Khan", details_complete: false },
    ]);
    // Saving again does not add a second waiver row.
    await saveHealth(w.db, layla, { consent: true, waiver: true }, NOW);
    expect((await w.db.query("select * from waivers")).rows).toHaveLength(1);
  });

  it("saves health with consent but leaves bookings incomplete until the waiver is accepted", async () => {
    const { layla } = await retreatWithGuest();
    expect(await saveHealth(w.db, layla, { consent: true }, NOW)).toEqual({ ok: true, complete: false });
    const g = await w.db.query<{ details_complete: boolean }>("select details_complete from booking_guests where person_id = $1", [layla]);
    expect(g.rows[0].details_complete).toBe(false);
  });

  it("does not mark past bookings complete", async () => {
    const { layla } = await retreatWithGuest();
    await saveHealth(w.db, layla, { consent: true, waiver: true }, new Date("2027-07-01T00:00:00Z"));
    const g = await w.db.query<{ details_complete: boolean }>("select details_complete from booking_guests where person_id = $1", [layla]);
    expect(g.rows[0].details_complete).toBe(false);
  });
});

describe("profile", () => {
  it("updates name and phone, and records a newsletter withdrawal", async () => {
    const me = await person("Mona", "mona@example.com");
    await w.db.query("update people set marketing_consent = true, marketing_consent_at = now() where id = $1", [me]);
    expect(await saveProfile(w.db, me, { name: " Mona K ", phone: "+971 50", marketingConsent: false })).toEqual({ ok: true });
    expect(await loadProfile(w.db, me)).toEqual({ name: "Mona K", email: "mona@example.com", phone: "+971 50", marketingConsent: false });
    const r = await w.db.query<{ withdrawn: boolean }>(
      "select marketing_consent_withdrawn_at is not null as withdrawn from people where id = $1",
      [me],
    );
    expect(r.rows[0].withdrawn).toBe(true);
    expect((await saveProfile(w.db, me, { name: "", marketingConsent: false })).ok).toBe(false);
  });
});

describe("requestDeletion", () => {
  it("records one deletion request and emails Tanya", async () => {
    const me = await person("Mona", "mona@example.com");
    const sent: { kind: string; data: Record<string, unknown> }[] = [];
    const send = async (kind: string, _to: string, data: Record<string, unknown>) => {
      sent.push({ kind, data });
    };
    expect(await requestDeletion(w.db, send, me)).toEqual({ alreadyRequested: false });
    expect(await requestDeletion(w.db, send, me)).toEqual({ alreadyRequested: true });
    const r = await w.db.query<{ type: string; person_id: string }>("select type, person_id from requests");
    expect(r.rows).toEqual([{ type: "deletion", person_id: me }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("request_received");
    expect(sent[0].data).toMatchObject({ type: "deletion", email: "mona@example.com" });
  });
});

describe("resendGiftCard", () => {
  async function setup() {
    const me = await person("Mona", "mona@example.com");
    const friend = await person("Fadi", "fadi@example.com");
    const [mine] = await issueGiftCards(w.db, {
      count: 1,
      initialAedMinor: 20000,
      buyerPersonId: friend,
      recipient: { name: "Mona", email: "mona@example.com" },
      deliverOn: "2027-01-10",
      paymentRef: "pi_m",
    });
    const [theirs] = await issueGiftCards(w.db, { count: 1, initialAedMinor: 10000, buyerPersonId: friend, deliverOn: "2027-01-10", paymentRef: "pi_t" });
    await activateGiftCards(w.db, "pi_m", NOW);
    await activateGiftCards(w.db, "pi_t", NOW);
    const sent: { kind: string; to: string; data: Record<string, unknown> }[] = [];
    const deps = {
      origin: "https://efzin.test",
      now: NOW,
      sendEmail: async (kind: string, to: string, data: Record<string, unknown>) => {
        sent.push({ kind, to, data });
      },
    };
    return { me, mine, theirs, sent, deps };
  }

  it("sends the code to the signed-in holder's own email only", async () => {
    const { me, mine, sent, deps } = await setup();
    expect(await resendGiftCard(w.db, deps, me, mine.id)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "gift_card_delivered", to: "mona@example.com" });
    expect(sent[0].data.code).toBe(mine.code);
  });

  it("refuses a card that is not theirs", async () => {
    const { me, theirs, sent, deps } = await setup();
    expect(await resendGiftCard(w.db, deps, me, theirs.id)).toBe("not_found");
    expect(await resendGiftCard(w.db, deps, me, "not-a-uuid")).toBe("not_found");
    expect(sent).toHaveLength(0);
  });

  it("allows 3 re-sends per hour per person", async () => {
    const { me, mine, sent, deps } = await setup();
    for (let i = 0; i < 3; i++) expect(await resendGiftCard(w.db, deps, me, mine.id)).toBe("sent");
    expect(await resendGiftCard(w.db, deps, me, mine.id)).toBe("throttled");
    expect(sent).toHaveLength(3);
    const later = { ...deps, now: new Date(NOW.getTime() + 61 * 60_000) };
    expect(await resendGiftCard(w.db, later, me, mine.id)).toBe("sent");
  });
});

describe("bookingStatusBySession", () => {
  it("is pending until the webhook confirms, then gives the first name, health task and pending guests", async () => {
    const { pendingId, sessionId } = await checkout(w, EVENT, {
      lines: [{ ticketKey: "whole", qty: 2 }],
      guests: [{ name: "Sara Khan", email: "sara@email.com", ticketKey: "whole" }],
    });
    expect(await bookingStatusBySession(w.db, sessionId)).toEqual({ status: "pending" });
    expect(await bookingStatusBySession(w.db, "cs_unknown")).toEqual({ status: "pending" });
    await handleStripeEvent(completedBooking("evt_e", pendingId, sessionId), w.deps);
    const s = await bookingStatusBySession(w.db, sessionId);
    expect(s).toMatchObject({
      status: "confirmed",
      firstName: "Layla",
      title: "Test Event",
      venue: "Somewhere",
      healthDone: false,
      pendingGuests: ["Sara"],
    });
    const layla = await idOf("layla@email.com");
    await saveHealth(w.db, layla, { consent: true, waiver: true }, NOW);
    expect(await bookingStatusBySession(w.db, sessionId)).toMatchObject({ healthDone: true });
  });
});
