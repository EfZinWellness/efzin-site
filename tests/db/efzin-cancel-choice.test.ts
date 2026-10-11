import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBooking } from "../../lib/account/bookings";
import { loadCancellationChoices } from "../../lib/admin/payments";
import { loadRevenue } from "../../lib/admin/upcoming";
import { runCancelExperience } from "../../lib/booking/cancelExperience";
import { decideChoice, loadChoiceView, resendChoiceEmail } from "../../lib/booking/efzinChoice";
import { runDaily } from "../../lib/cron/daily";
import { renderEmail } from "../../lib/email/render";
import { ORIGIN, world, type World } from "./webhookFixtures";
import { EVENT_START, daysBefore, giftBalance, paidEvent, refunds, retreatPlan, spots, status } from "./selfServiceFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const NOW = daysBefore(EVENT_START, 3);
const sent = () => w.emails.map((e) => `${e.kind}>${e.to}`).sort();
const opts = () => ({ now: NOW, sendEmail: w.deps.sendEmail, origin: ORIGIN, outDir: mkdtempSync(join(tmpdir(), "efzin-cancel-")) });
const choiceRow = async (bookingId: string) =>
  (
    await w.db.query<{ token: string; offered_at: Date; deadline_at: Date; choice: string | null; decided_by: string | null }>(
      "select token, offered_at, deadline_at, choice, decided_by from cancellation_choices where booking_id = $1",
      [bookingId],
    )
  ).rows[0];

/** Ef Zin cancels the event (2 bookings, Layla with a guest); returns the bookings and tokens. */
async function cancelEvent() {
  const a = await paidEvent(w, "layla@x.com", [{ name: "Sara S", email: "sara@x.com" }]);
  const b = await paidEvent(w, "omar@x.com");
  const r = await runCancelExperience(w.db, w.stripe, "test-event", "send", opts());
  expect(r.failures).toEqual([]);
  return { a, b, tokenA: (await choiceRow(a.bookingId)).token, tokenB: (await choiceRow(b.bookingId)).token };
}

describe("Ef Zin cancels: the guest chooses refund or credit", () => {
  it("--send cancels and frees the spots but moves no money; the booker gets the choice email with two links", async () => {
    const before = await spots(w.db, (await paidEvent(w, "zed@x.com")).ticketId);
    await w.db.query("update bookings set status = 'cancelled' where booker_person_id = (select id from people where email = 'zed@x.com')");
    const { a, b, tokenA } = await cancelEvent();
    for (const id of [a.bookingId, b.bookingId]) {
      const row = (
        await w.db.query<{ status: string; cancelled_by: string; cancel_reason: string; cancelled_at: Date }>(
          "select status, cancelled_by, cancel_reason, cancelled_at from bookings where id = $1",
          [id],
        )
      ).rows[0];
      expect(row).toMatchObject({ status: "cancelled", cancelled_by: "efzin", cancel_reason: "efzin_cancelled" });
    }
    expect(await spots(w.db, a.ticketId)).toBe(before + 1);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.stripe.chargeListCalls).toEqual([]);
    expect(await w.db.query("select * from credits")).toMatchObject({ rows: [] });

    const c = await choiceRow(a.bookingId);
    expect(c.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.choice).toBeNull();
    expect(new Date(c.offered_at).toISOString()).toBe(NOW.toISOString());
    expect(new Date(c.deadline_at).getTime() - new Date(c.offered_at).getTime()).toBe(7 * 86_400_000);

    expect(sent()).toEqual([
      "booking_cancelled>sara@x.com",
      "efzin_cancellation_choice>layla@x.com",
      "efzin_cancellation_choice>omar@x.com",
    ]);
    expect(w.emails.find((e) => e.to === "sara@x.com")!.data).toMatchObject({ byEfzin: true, forGuest: true });
    const mail = w.emails.find((e) => e.kind === "efzin_cancellation_choice" && e.to === "layla@x.com")!;
    expect(mail.data).toMatchObject({
      refundUrl: `${ORIGIN}/account/cancellation/${tokenA}?choice=refund`,
      creditUrl: `${ORIGIN}/account/cancellation/${tokenA}?choice=credit`,
      amountMinor: 28000,
      currency: "AED",
    });
    const r = await renderEmail("efzin_cancellation_choice", mail.data);
    expect(r.subject).toBe("Test Event has been cancelled: refund or credit?");
    expect(r.text).toContain(`/account/cancellation/${tokenA}?choice=refund`);
    expect(r.text).toContain(`/account/cancellation/${tokenA}?choice=credit`);
    expect(r.text).toContain("AED 280");
    expect(r.text).not.toContain("layla@x.com");
  });

  it("refund: the full amount back to the card with no fees deducted; the booker is told", async () => {
    const { a, tokenA } = await cancelEvent();
    w.emails.length = 0;
    const out = await decideChoice(w.db, w.stripe, tokenA, "refund", "guest", NOW, { sendEmail: w.deps.sendEmail });
    expect(out).toMatchObject({ outcome: "decided", choice: "refund", decidedBy: "guest", problems: [] });
    expect(refunds(w)).toEqual([{ charge: "ch_layla@x.com", amount: 28000 }]);
    expect(await status(w.db, "bookings", a.bookingId)).toBe("refunded");
    expect(await choiceRow(a.bookingId)).toMatchObject({ choice: "refund", decided_by: "guest" });
    expect(sent()).toEqual(["booking_cancelled>layla@x.com"]);
    expect(w.emails[0].data).toMatchObject({ byEfzin: true, cardRefunds: [{ amountMinor: 28000, currency: "AED" }], feesDeductedMinor: 0 });
  });

  it("refund with a gift card: the gift part goes back to the card, the card charges in full", async () => {
    const b = await retreatPlan(w, true);
    const before = await giftBalance(w.db, b.cardId!);
    await runCancelExperience(w.db, w.stripe, "test-retreat", "send", opts());
    await decideChoice(w.db, w.stripe, (await choiceRow(b.bookingId)).token, "refund", "guest", NOW, { sendEmail: w.deps.sendEmail });
    expect(await giftBalance(w.db, b.cardId!)).toBe(before + 120000);
    expect(refunds(w).sort((x, y) => String(x.charge).localeCompare(String(y.charge)))).toEqual([
      { charge: "ch_dep", amount: 18000 },
      { charge: "ch_inst", amount: 48000 },
    ]);
  });

  it("credit: the full amount paid as AED credit expiring in 12 months; nothing refunded", async () => {
    const { a, tokenA } = await cancelEvent();
    w.emails.length = 0;
    await decideChoice(w.db, w.stripe, tokenA, "credit", "guest", NOW, { sendEmail: w.deps.sendEmail });
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(await status(w.db, "bookings", a.bookingId)).toBe("credited");
    const c = (
      await w.db.query<{ amount_aed_minor: number; expires_at: Date; code: string }>(
        "select amount_aed_minor, expires_at, code from credits where source_booking_id = $1",
        [a.bookingId],
      )
    ).rows;
    expect(c).toHaveLength(1);
    expect(c[0].amount_aed_minor).toBe(28000);
    expect(new Date(c[0].expires_at).toISOString()).toBe("2028-01-29T06:00:00.000Z");
    expect(w.emails[0]).toMatchObject({ kind: "booking_cancelled", to: "layla@x.com", data: { creditAed: 28000, creditCode: c[0].code } });
  });

  it("a second submit (or the other button afterwards) changes nothing and reports the choice already made", async () => {
    const { a, tokenA } = await cancelEvent();
    await decideChoice(w.db, w.stripe, tokenA, "credit", "guest", NOW, { sendEmail: w.deps.sendEmail });
    const again = await decideChoice(w.db, w.stripe, tokenA, "refund", "guest", NOW, { sendEmail: w.deps.sendEmail });
    expect(again).toMatchObject({ outcome: "already_decided", choice: "credit", decidedBy: "guest" });
    expect(w.stripe.refundsCreated).toEqual([]);
    expect((await w.db.query("select * from credits where source_booking_id = $1", [a.bookingId])).rows).toHaveLength(1);
    expect(w.emails.filter((e) => e.kind === "booking_cancelled" && e.to === "layla@x.com")).toHaveLength(1);
  });

  it("no choice by the deadline: the daily job refunds in full (decided by default) and tells the guest", async () => {
    const { a, b } = await cancelEvent();
    w.emails.length = 0;
    const deps = { stripe: w.stripe, sendEmail: w.deps.sendEmail, origin: ORIGIN };
    await runDaily(w.db, new Date(NOW.getTime() + 6 * 86_400_000), deps);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect((await choiceRow(a.bookingId)).choice).toBeNull();

    await runDaily(w.db, new Date(NOW.getTime() + 7 * 86_400_000 + 3_600_000), deps);
    expect(refunds(w).sort((x, y) => String(x.charge).localeCompare(String(y.charge)))).toEqual([
      { charge: "ch_layla@x.com", amount: 28000 },
      { charge: "ch_omar@x.com", amount: 28000 },
    ]);
    for (const id of [a.bookingId, b.bookingId]) {
      expect(await choiceRow(id)).toMatchObject({ choice: "refund", decided_by: "default" });
      expect(await status(w.db, "bookings", id)).toBe("refunded");
    }
    const notes = w.emails.filter((e) => e.kind === "booking_cancelled");
    expect(notes.map((e) => e.to).sort()).toEqual(["layla@x.com", "omar@x.com"]);
    expect(notes[0].data).toMatchObject({ byEfzin: true, defaulted: true });
    const r = await renderEmail("booking_cancelled", notes[0].data);
    expect(r.text).toContain("didn't hear back");
  });

  it("the page needs only the unguessable token and reveals just the first name, experience and amount", async () => {
    const { tokenA } = await cancelEvent();
    expect(await loadChoiceView(w.db, randomUUID())).toBeNull();
    expect(await loadChoiceView(w.db, "not-a-token")).toBeNull();
    const v = await loadChoiceView(w.db, tokenA);
    expect(v).toEqual({
      firstName: "Layla",
      experience: "Test Event",
      amountMinor: 28000,
      currency: "AED",
      creditAedMinor: 28000,
      deadlineAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      choice: null,
      decidedBy: null,
    });
    await expect(decideChoice(w.db, w.stripe, randomUUID(), "refund", "guest", NOW, { sendEmail: w.deps.sendEmail })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(w.stripe.refundsCreated).toEqual([]);
  });

  it("/admin/payments lists the choices: booking, guest, amount, deadline, choice", async () => {
    const { a, tokenA } = await cancelEvent();
    await decideChoice(w.db, w.stripe, tokenA, "credit", "guest", NOW, { sendEmail: w.deps.sendEmail });
    const rows = await loadCancellationChoices(w.db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.bookingId === a.bookingId)).toMatchObject({
      title: "Test Event",
      slug: "test-event",
      bookerName: "Layla H",
      bookerEmail: "layla@x.com",
      amountMinor: 28000,
      currency: "AED",
      deadlineAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      choice: "credit",
      decidedBy: "guest",
    });
    expect(rows.find((r) => r.bookingId !== a.bookingId)).toMatchObject({ choice: null, decidedBy: null });
  });

  it("a choice email that fails is reported: Tanya is alerted with the booking id and --send does not claim success", async () => {
    const a = await paidEvent(w, "layla@x.com");
    const failing: typeof w.deps.sendEmail = async (kind, to, data) => {
      if (kind === "efzin_cancellation_choice") throw new Error("resend down");
      w.emails.push({ kind, to, data });
    };
    const r = await runCancelExperience(w.db, w.stripe, "test-event", "send", { ...opts(), sendEmail: failing });
    expect(r.outcomes).toEqual([expect.objectContaining({ bookingId: a.bookingId, cancelled: true, emailSent: false })]);
    const alert = w.emails.find((e) => e.kind === "admin_error" && e.data.context === "efzin_choice_email_failed");
    expect(alert?.data).toMatchObject({ bookingId: a.bookingId });
  });

  it("Tanya can resend the choice email (same token) while the choice is open, not after", async () => {
    const { a, tokenA } = await cancelEvent();
    w.emails.length = 0;
    expect(await resendChoiceEmail(w.db, a.bookingId, { sendEmail: w.deps.sendEmail, origin: ORIGIN })).toBe(true);
    expect(sent()).toEqual(["efzin_cancellation_choice>layla@x.com"]);
    expect(w.emails[0].data).toMatchObject({ refundUrl: `${ORIGIN}/account/cancellation/${tokenA}?choice=refund` });
    await decideChoice(w.db, w.stripe, tokenA, "refund", "guest", NOW, { sendEmail: w.deps.sendEmail });
    w.emails.length = 0;
    expect(await resendChoiceEmail(w.db, a.bookingId, { sendEmail: w.deps.sendEmail, origin: ORIGIN })).toBe(false);
    expect(w.emails).toEqual([]);
  });

  it("credit is refused (Tanya alerted) when a charge was refunded by hand after the cancellation; nothing changes", async () => {
    const { a, tokenA } = await cancelEvent();
    w.emails.length = 0;
    w.stripe.chargeStore["ch_layla@x.com"].amount_refunded = 28000;
    w.stripe.existingRefunds.push({
      id: "re_hand",
      charge: "ch_layla@x.com",
      amount: 28000,
      status: "succeeded",
      metadata: {},
      created: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    await expect(decideChoice(w.db, w.stripe, tokenA, "credit", "guest", NOW, { sendEmail: w.deps.sendEmail })).rejects.toMatchObject({
      code: "needs_review",
    });
    expect((await w.db.query("select * from credits")).rows).toEqual([]);
    expect((await choiceRow(a.bookingId)).choice).toBeNull();
    expect(await status(w.db, "bookings", a.bookingId)).toBe("cancelled");
    const alert = w.emails.find((e) => e.kind === "admin_error" && e.data.context === "efzin_credit_after_manual_refund");
    expect(alert?.data).toMatchObject({ bookingId: a.bookingId });
  });

  it("undecided Ef Zin cancellations are not counted as revenue", async () => {
    await paidEvent(w, "layla@x.com");
    await paidEvent(w, "omar@x.com");
    expect((await loadRevenue(w.db)).experienceAedMinor).toBe(56000);
    await runCancelExperience(w.db, w.stripe, "test-event", "send", opts());
    expect((await loadRevenue(w.db)).experienceAedMinor).toBe(0);
    // An unpaid-balance cancellation that kept the deposit still counts (unchanged).
    await w.db.query("update bookings set cancel_reason = 'unpaid_balance' where id = (select id from bookings limit 1)");
    expect((await loadRevenue(w.db)).experienceAedMinor).toBe(28000);
  });

  it("My Ef Zin offers the booker the choice link while it is open", async () => {
    const { a, tokenA } = await cancelEvent();
    const booker = (await w.db.query<{ id: string }>("select booker_person_id as id from bookings where id = $1", [a.bookingId])).rows[0].id;
    const sara = (await w.db.query<{ id: string }>("select id from people where email = 'sara@x.com'")).rows[0].id;
    expect((await loadBooking(w.db, booker, a.bookingId))?.choiceToken).toBe(tokenA);
    expect((await loadBooking(w.db, sara, a.bookingId))?.choiceToken).toBeNull();
    await decideChoice(w.db, w.stripe, tokenA, "credit", "guest", NOW, { sendEmail: w.deps.sendEmail });
    expect((await loadBooking(w.db, booker, a.bookingId))?.choiceToken).toBeNull();
  });

  it("--dry-run previews the choice email, calls no Stripe API and changes nothing", async () => {
    const a = await paidEvent(w, "layla@x.com");
    const o = opts();
    await runCancelExperience(w.db, w.stripe, "test-event", "dry-run", o);
    expect(w.stripe.chargeListCalls).toEqual([]);
    expect(w.stripe.refundsCreated).toEqual([]);
    expect(w.emails).toEqual([]);
    expect(await status(w.db, "bookings", a.bookingId)).toBe("paid");
    expect((await w.db.query("select * from cancellation_choices")).rows).toEqual([]);
    const files = readdirSync(o.outDir);
    const text = readFileSync(join(o.outDir, files[0]), "utf8");
    expect(text).toContain("refund or credit?");
    expect(text).toContain("?choice=refund");
    expect(text).toContain("?choice=credit");
    expect(text).toContain("layla@x.com");
  });
});
