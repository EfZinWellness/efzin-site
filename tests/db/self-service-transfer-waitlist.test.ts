import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelBooking } from "../../lib/booking/cancel";
import { runCancelExperience } from "../../lib/booking/cancelExperience";
import { transferSpot, TransferError } from "../../lib/booking/transfer";
import { handleWaitlist, joinWaitlist, notifyWaitlist } from "../../lib/booking/waitlist";
import { ORIGIN, world, type World } from "./webhookFixtures";
import { EVENT_START, RETREAT_START, daysBefore, hoursBefore, paidEvent, refunds, retreatPlan, status } from "./selfServiceFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const sent = () => w.emails.map((e) => `${e.kind}>${e.to}`).sort();
const guestRow = async (bookingId: string, isBooker: boolean) =>
  (
    await w.db.query<{ id: string; person_id: string; details_complete: boolean; email: string }>(
      `select g.id, g.person_id, g.details_complete, p.email from booking_guests g join people p on p.id = g.person_id
        where g.booking_id = $1 and g.is_booker = $2`,
      [bookingId, isBooker],
    )
  ).rows[0];

describe("transfers", () => {
  const fx = () => ({ sendEmail: w.deps.sendEmail, auth: w.auth, origin: ORIGIN });

  it("1 hour before an event is too late: rejected, nothing changes", async () => {
    const b = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com", detailsComplete: true }]);
    const g = await guestRow(b.bookingId, false);
    await expect(
      transferSpot(w.db, g.id, { name: "Nour N", email: "nour@x.com" }, hoursBefore(EVENT_START, 1), { ...fx(), byPersonId: b.bookerId }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    expect((await guestRow(b.bookingId, false)).email).toBe("sara@x.com");
    expect(w.emails).toEqual([]);
  });

  it("3 hours before: the friend's place goes to the new guest, details reset, both told", async () => {
    const b = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com", detailsComplete: true }]);
    const g = await guestRow(b.bookingId, false);
    await transferSpot(w.db, g.id, { name: "Nour N", email: "Nour@X.com" }, hoursBefore(EVENT_START, 3), { ...fx(), byPersonId: b.bookerId });
    const after = await guestRow(b.bookingId, false);
    expect(after).toMatchObject({ id: g.id, email: "nour@x.com", details_complete: false });
    expect(sent()).toEqual(["booking_transferred>sara@x.com", "guest_added>nour@x.com"]);
    expect(w.emails.find((e) => e.kind === "guest_added")!.data).toMatchObject({ bookerName: "Layla H", name: "Nour N" });
  });

  it("only the booker may transfer, never to someone already on the booking", async () => {
    const b = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com" }]);
    const g = await guestRow(b.bookingId, false);
    const now = hoursBefore(EVENT_START, 30);
    await expect(transferSpot(w.db, g.id, { name: "N", email: "n@x.com" }, now, { ...fx(), byPersonId: g.person_id })).rejects.toBeInstanceOf(
      TransferError,
    );
    await expect(
      transferSpot(w.db, g.id, { name: "L", email: "layla@x.com" }, now, { ...fx(), byPersonId: b.bookerId }),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("retreats can be transferred any time before the start, even within 30 days", async () => {
    const b = await retreatPlan(w, false);
    const g = await guestRow(b.bookingId, true);
    await transferSpot(w.db, g.id, { name: "Dina D", email: "dina@x.com" }, daysBefore(RETREAT_START, 5), { ...fx(), byPersonId: b.bookerId });
    expect((await guestRow(b.bookingId, false)).email).toBe("dina@x.com");
  });
});

describe("waitlist", () => {
  const deps = (now: Date) => ({ sendEmail: w.deps.sendEmail, origin: ORIGIN, now });

  it("joins only when sold out, once per email; a cancellation emails everyone not yet notified, once", async () => {
    const now = daysBefore(EVENT_START, 5);
    // The "small" ticket has one spot.
    const tt = (await w.db.query<{ id: string }>("select id from ticket_types where key = 'small'")).rows[0].id;
    expect(await joinWaitlist(w.db, tt, { name: "Early", email: "early@x.com" }, now)).toBe("available");
    const b = await paidEvent(w);
    expect(await joinWaitlist(w.db, tt, { name: "Amy A", email: "amy@x.com" }, now)).toBe("joined");
    expect(await joinWaitlist(w.db, tt, { name: "Amy A", email: "AMY@x.com" }, now)).toBe("already");
    expect(await joinWaitlist(w.db, tt, { name: "Ben B", email: "ben@x.com" }, now)).toBe("joined");

    await cancelBooking(w.db, w.stripe, b.bookingId, "refund", "guest", now, { sendEmail: w.deps.sendEmail, origin: ORIGIN });
    expect(w.emails.filter((e) => e.kind === "waitlist_open").map((e) => e.to)).toEqual(["amy@x.com", "ben@x.com"]);
    expect(w.emails.find((e) => e.kind === "waitlist_open")!.data).toMatchObject({ link: `${ORIGIN}/book/test-event` });

    w.emails.length = 0;
    expect(await notifyWaitlist(w.db, tt, deps(now))).toBe(0);
    expect(w.emails).toEqual([]);
  });

  it("the public form: honeypot ignored, bad input rejected, joins by slug and ticket", async () => {
    const now = daysBefore(EVENT_START, 5);
    await paidEvent(w);
    expect(await handleWaitlist({ slug: "test-event", name: "Bot", email: "b@x.com", website: "spam" }, { db: w.db, now })).toMatchObject({
      status: 200,
      result: "ignored",
    });
    expect((await handleWaitlist({ slug: "test-event", name: "", email: "nope" }, { db: w.db, now })).status).toBe(400);
    expect(await handleWaitlist({ slug: "test-event", ticket: "small", name: "Amy", email: "amy@x.com" }, { db: w.db, now })).toMatchObject({
      status: 200,
      result: "joined",
    });
    expect((await handleWaitlist({ slug: "nope", name: "Amy", email: "amy@x.com" }, { db: w.db, now })).status).toBe(404);
    const rows = (await w.db.query<{ name: string; email: string }>("select name, email from waitlist")).rows;
    expect(rows).toEqual([{ name: "Amy", email: "amy@x.com" }]);
  });
});

describe("cancel-experience (Ef Zin cancels every booking)", () => {
  async function twoBookings() {
    const a = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com" }]);
    const b = await paidEvent(w, "omar@x.com");
    return [a, b];
  }

  it("--dry-run writes the guest email for Tanya's approval and calls no Stripe API, changing nothing", async () => {
    const [a, b] = await twoBookings();
    const outDir = mkdtempSync(join(tmpdir(), "efzin-cancel-"));
    const r = await runCancelExperience(w.db, w.stripe, "test-event", "dry-run", {
      now: daysBefore(EVENT_START, 3),
      sendEmail: w.deps.sendEmail,
      origin: ORIGIN,
      outDir,
    });
    expect(r.bookings).toBe(2);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.stripe.chargeListCalls).toEqual([]);
    expect(w.emails).toEqual([]);
    expect(await status(w.db, "bookings", a.bookingId)).toBe("paid");
    expect(await status(w.db, "bookings", b.bookingId)).toBe("paid");
    const files = readdirSync(outDir);
    expect(files).toHaveLength(1);
    const text = readFileSync(join(outDir, files[0]), "utf8");
    expect(text).toContain("Test Event");
    expect(text).toContain("layla@x.com");
    expect(text).toContain("full refund");
  });

  it("--send cancels every booking, moves no money yet, asks each booker to choose refund or credit and tells the guests", async () => {
    const [a, b] = await twoBookings();
    const r = await runCancelExperience(w.db, w.stripe, "test-event", "send", {
      now: daysBefore(EVENT_START, 1),
      sendEmail: w.deps.sendEmail,
      origin: ORIGIN,
      outDir: mkdtempSync(join(tmpdir(), "efzin-cancel-")),
    });
    expect(r.bookings).toBe(2);
    expect(refunds(w)).toEqual([]);
    for (const id of [a.bookingId, b.bookingId]) expect(await status(w.db, "bookings", id)).toBe("cancelled");
    expect(sent()).toEqual(["booking_cancelled>sara@x.com", "efzin_cancellation_choice>layla@x.com", "efzin_cancellation_choice>omar@x.com"]);
    expect(w.emails.filter((e) => e.kind === "waitlist_open")).toEqual([]);
  });
});
