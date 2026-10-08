import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHourly } from "../../lib/cron/hourly";
import { runGiftDelivery } from "../../lib/cron/giftDelivery";
import { reportError } from "../../lib/errors/report";
import { activateGiftCards, issueGiftCards } from "../../lib/giftcards/db";
import { policyCopy } from "../../lib/policy/copy";
import type { EmailAttachment } from "../../lib/email/send";
import { captureEmails, kinds, person, type Captured } from "./cronFixtures";
import { checkout, count, EVENT, giftCard, NOW, ORIGIN, planBooking, completedBooking, world, type World } from "./webhookFixtures";
import { handleStripeEvent } from "../../lib/stripe/handlers";

const ADMIN = "contact@efzinwellness.com";

let w: World;
let sent: Captured[];
let restore: () => void;
let fail: (on: boolean) => void;
let send: ReturnType<typeof captureEmails>["send"];

beforeEach(async () => {
  w = await world();
  const c = captureEmails();
  ({ sent, restore, fail, send } = c);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe("sendEmail with email_log", () => {
  const data = { name: "Sara", experience: "Sound Bath" };

  it("sends a (kind, to, ref) once; other refs and recipients still go", async () => {
    await send("day_before", "sara@x.com", data, undefined, { ref: "g1", db: w.db });
    await send("day_before", "SARA@x.com", data, undefined, { ref: "g1", db: w.db });
    await send("day_before", "sara@x.com", data, undefined, { ref: "g2", db: w.db });
    await send("day_after", "sara@x.com", data, undefined, { ref: "g1", db: w.db });
    expect(kinds(sent)).toEqual(["day_after>sara@x.com", "day_before>sara@x.com", "day_before>sara@x.com"]);
    expect(await count(w.db, "select * from email_log")).toBe(3);
  });

  it("without a ref nothing is logged or deduplicated (backwards compatible)", async () => {
    await send("day_before", "sara@x.com", data);
    await send("day_before", "sara@x.com", data);
    expect(sent).toHaveLength(2);
    expect(await count(w.db, "select * from email_log")).toBe(0);
  });

  it("a failed send is not logged, so the next run retries it", async () => {
    fail(true);
    await expect(send("day_before", "sara@x.com", data, undefined, { ref: "g1", db: w.db })).rejects.toThrow("transport down");
    expect(await count(w.db, "select * from email_log")).toBe(0);
    fail(false);
    await send("day_before", "sara@x.com", data, undefined, { ref: "g1", db: w.db });
    expect(sent).toHaveLength(1);
  });
});

describe("reportError", () => {
  it("logs and emails Tanya at most once per context per hour, and never throws", async () => {
    const at = new Date("2027-01-10T09:05:00Z");
    const opts = (now: Date) => ({ db: w.db, now, sendEmail: send });
    await reportError(new Error("boom"), "daily_charge", opts(at));
    await reportError(new Error("boom again"), "daily_charge", opts(new Date("2027-01-10T09:55:00Z")));
    await reportError(new Error("other"), "hourly_release", opts(at));
    await reportError(new Error("later"), "daily_charge", opts(new Date("2027-01-10T10:01:00Z")));
    expect(kinds(sent)).toEqual([`admin_error>${ADMIN}`, `admin_error>${ADMIN}`, `admin_error>${ADMIN}`]);
    expect(sent[0].text).toContain("boom");
    expect(console.error).toHaveBeenCalledTimes(4);
    fail(true);
    await expect(reportError(new Error("x"), "new_context", opts(at))).resolves.toBeUndefined();
  });
});

describe("hourly job", () => {
  it("releases holds and gift reservations once they expired more than 5 minutes ago", async () => {
    const code = await giftCard(w.db, 10000);
    await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: code });
    const exp = (await w.db.query<{ t: string }>("select max(expires_at)::text as t from holds")).rows[0].t;
    const expiresAt = new Date(exp);
    const live = async () => ({
      holds: await count(w.db, "select * from holds where released_at is null"),
      reservations: await count(w.db, "select * from gift_card_reservations where released_at is null"),
    });

    await runHourly(w.db, new Date(expiresAt.getTime() + 4 * 60_000), { sendEmail: send });
    expect(await live()).toEqual({ holds: 1, reservations: 1 });
    await runHourly(w.db, new Date(expiresAt.getTime() + 6 * 60_000), { sendEmail: send });
    expect(await live()).toEqual({ holds: 0, reservations: 0 });
    expect(sent).toEqual([]);
  });

  it("removes gift cards still awaiting payment after 24 hours, never active ones", async () => {
    const buyer = await person(w.db, "Mona M", "mona@x.com");
    const now = new Date("2027-01-10T09:00:00Z");
    const issue = (ref: string, n = 1) =>
      issueGiftCards(w.db, { count: n, initialAedMinor: 50000, buyerPersonId: buyer, deliverOn: "2027-01-10", paymentRef: ref });
    const [stale] = await issue("pi_stale");
    await issue("pi_bulk", 2);
    const [fresh] = await issue("pi_fresh");
    const [active] = await issue("pi_active");
    await activateGiftCards(w.db, "pi_active", now);
    await w.db.query("update gift_cards set created_at = $1", ["2027-01-08T09:00:00Z"]);
    await w.db.query("update gift_card_batches set created_at = $1", ["2027-01-08T09:00:00Z"]);
    await w.db.query("update gift_cards set created_at = $2 where id = $1", [fresh.id, "2027-01-10T08:00:00Z"]);

    await runHourly(w.db, now, { sendEmail: send });
    const left = (await w.db.query<{ id: string }>("select id from gift_cards order by created_at")).rows.map((r) => r.id).sort();
    expect(left).toEqual([active.id, fresh.id].sort());
    expect(left).not.toContain(stale.id);
    expect(await count(w.db, "select * from gift_card_batches")).toBe(0);
  });
});

describe("gift delivery job", () => {
  it("delivers the cards due today in Dubai", async () => {
    const buyer = await person(w.db, "Mona M", "mona@x.com");
    await issueGiftCards(w.db, {
      count: 1,
      initialAedMinor: 50000,
      buyerPersonId: buyer,
      recipient: { name: "Noor", email: "noor@x.com" },
      deliverOn: "2027-01-10",
      paymentRef: "pi_g",
    });
    await activateGiftCards(w.db, "pi_g", NOW);
    const n = await runGiftDelivery(w.db, new Date("2027-01-10T04:00:00Z"), { sendEmail: send, origin: ORIGIN });
    expect(n).toBe(1);
    expect(kinds(sent)).toEqual(["gift_card_delivered>noor@x.com", "gift_card_delivered_buyer>mona@x.com"]);
  });
});

describe("booking confirmation emails", () => {
  type Got = { kind: string; to: string; data: Record<string, unknown>; attachments?: EmailAttachment[] };
  let got: Got[];
  beforeEach(() => {
    got = [];
    w.deps.sendEmail = async (kind, to, data, attachments) => {
      got.push({ kind, to, data, ...(attachments ? { attachments } : {}) });
    };
  });

  it("carry the calendar invite (UTC times) and the policy agreed at checkout", async () => {
    await planBooking(w);
    const conf = got.find((g) => g.kind === "booking_confirmed")!;
    expect(conf.data).toMatchObject({ timezone: "Europe/Athens", venue: "Somewhere", calendar: true, policy: policyCopy("standard_retreat") });
    expect(conf.attachments).toHaveLength(1);
    const ics = conf.attachments![0];
    expect(ics).toMatchObject({ filename: "ef-zin-test-retreat.ics", contentType: "text/calendar; charset=utf-8; method=PUBLISH" });
    expect(String(ics.content)).toContain("DTSTART:20270610T070000Z");
  });

  it("tell the holder how much of their gift card was used and what is left", async () => {
    const code = await giftCard(w.db, 10000);
    const { pendingId, sessionId } = await checkout(w, EVENT, { lines: [{ ticketKey: "whole", qty: 1 }], giftCode: code });
    await handleStripeEvent(completedBooking("evt_g", pendingId, sessionId), w.deps);
    const used = got.find((g) => g.kind === "gift_card_used")!;
    expect(used.to).toBe("layla@email.com");
    expect(used.data).toMatchObject({ amountUsedAedMinor: 10000, balanceAedMinor: 0, experience: "Test Event" });
  });
});
