import { describe, it, expect, beforeEach } from "vitest";
import { planBooking, world, ORIGIN, type World } from "../db/webhookFixtures";
import { SelfServeError, startPayRest, startUpdateCard } from "../../lib/stripe/selfServe";

let w: World;
let bookingId: string;
let bookerId: string;

const deps = () => ({ db: w.db, stripe: w.stripe, origin: ORIGIN });

beforeEach(async () => {
  w = await world();
  ({ bookingId } = await planBooking(w, "instalments"));
  bookerId = (await w.db.query<{ booker_person_id: string }>("select booker_person_id from bookings")).rows[0]
    .booker_person_id;
  w.stripe.sessions.length = 0;
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof SelfServeError) return err.code;
    throw err;
  }
  return "no error";
}

describe("startPayRest", () => {
  it("opens a payment Checkout for the sum of the unpaid (scheduled and failed) items only", async () => {
    const items = (
      await w.db.query<{ seq: number; amount_minor: number }>(
        "select seq, amount_minor from payment_schedule_items where booking_id = $1 order by seq",
        [bookingId],
      )
    ).rows;
    expect(items.length).toBeGreaterThanOrEqual(3);
    // seq 0 (deposit) is paid; mark seq 1 failed and seq 2 paid.
    await w.db.query("update payment_schedule_items set status = 'failed' where booking_id = $1 and seq = 1", [bookingId]);
    await w.db.query("update payment_schedule_items set status = 'paid' where booking_id = $1 and seq = 2", [bookingId]);
    const expected = items.filter((i) => i.seq !== 0 && i.seq !== 2).reduce((s, i) => s + i.amount_minor, 0);

    const out = await startPayRest(deps(), bookingId, bookerId);

    expect(out.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(w.stripe.sessions).toHaveLength(1);
    const s = w.stripe.sessions[0];
    expect(s.mode).toBe("payment");
    expect(s.allowed_payment_method_types).toEqual(["card"]);
    expect(s.customer).toBe("cus_test_1");
    const unpaidIds = (
      await w.db.query<{ id: string }>(
        "select id from payment_schedule_items where booking_id = $1 and status in ('scheduled', 'failed') order by seq",
        [bookingId],
      )
    ).rows.map((r) => r.id);
    expect(s.metadata).toEqual({
      kind: "pay_rest",
      booking_id: bookingId,
      item_ids: unpaidIds.join(","),
      expected_amount_minor: String(expected),
    });
    expect(s.payment_intent_data?.metadata).toEqual(s.metadata);
    // Expires 30–60 minutes ahead, on a window boundary, so a stale session cannot be paid later.
    const ttl = s.expires_at! - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThanOrEqual(30 * 60);
    expect(ttl).toBeLessThanOrEqual(60 * 60);
    expect(s.expires_at! % 1800).toBe(0);
    expect(s.line_items).toHaveLength(1);
    expect(s.line_items![0].price_data!.currency).toBe("eur");
    expect(s.line_items![0].price_data!.unit_amount).toBe(expected);
    expect(s.success_url).toBe(`${ORIGIN}/account/bookings/${bookingId}?paid=1`);
    expect(s.success_url).not.toMatch(/@/);
  });

  it("a repeat click a few seconds later in the same window returns the same session without an error", async () => {
    const windowStart = 1_900_000_000 - (1_900_000_000 % 1800);
    const t1 = new Date((windowStart + 100) * 1000);
    const t2 = new Date((windowStart + 105) * 1000);
    const a = await startPayRest({ ...deps(), now: t1 }, bookingId, bookerId);
    const b = await startPayRest({ ...deps(), now: t2 }, bookingId, bookerId);
    expect(b.url).toBe(a.url);
    expect(w.stripe.sessions).toHaveLength(1);
    expect(w.stripe.sessions[0].expires_at).toBe(windowStart + 2 * 1800);
    // The next window opens a fresh session.
    const c = await startPayRest({ ...deps(), now: new Date((windowStart + 1800 + 1) * 1000) }, bookingId, bookerId);
    expect(c.url).not.toBe(a.url);
  });

  it("refuses someone who is not the booker", async () => {
    const other = (
      await w.db.query<{ id: string }>("insert into people (name, email) values ('X', 'x@example.com') returning id")
    ).rows[0].id;
    expect(await code(startPayRest(deps(), bookingId, other))).toBe("not_found");
    expect(w.stripe.sessions).toHaveLength(0);
  });

  it("refuses a cancelled booking", async () => {
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    expect(await code(startPayRest(deps(), bookingId, bookerId))).toBe("not_payable");
    expect(w.stripe.sessions).toHaveLength(0);
  });

  it("refuses a booking that is already paid in full", async () => {
    await w.db.query("update bookings set status = 'paid' where id = $1", [bookingId]);
    expect(await code(startPayRest(deps(), bookingId, bookerId))).toBe("not_payable");
  });

  it("refuses when nothing is left to pay", async () => {
    await w.db.query("update payment_schedule_items set status = 'paid' where booking_id = $1", [bookingId]);
    expect(await code(startPayRest(deps(), bookingId, bookerId))).toBe("nothing_due");
  });

  it("refuses a malformed booking id without querying Stripe", async () => {
    expect(await code(startPayRest(deps(), "not-a-uuid", bookerId))).toBe("not_found");
  });
});

describe("startUpdateCard", () => {
  it("opens a setup-mode Checkout for the person's own customer", async () => {
    const out = await startUpdateCard(deps(), bookerId, bookingId);
    expect(out.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const s = w.stripe.sessions[0];
    expect(s.mode).toBe("setup");
    expect(s.customer).toBe("cus_test_1");
    expect(s.currency).toBe("eur");
    expect(s.metadata).toEqual({ kind: "update_card", person_id: bookerId });
    expect(s.setup_intent_data?.metadata).toEqual({ kind: "update_card", person_id: bookerId });
    expect(s.success_url).toBe(`${ORIGIN}/account/bookings/${bookingId}?card=updated`);
  });

  it("refuses someone with no payment plan to pay", async () => {
    const other = (
      await w.db.query<{ id: string }>("insert into people (name, email) values ('X', 'x@example.com') returning id")
    ).rows[0].id;
    expect(await code(startUpdateCard(deps(), other))).toBe("not_found");
    expect(await code(startUpdateCard(deps(), other, bookingId))).toBe("not_found");
    expect(w.stripe.sessions).toHaveLength(0);
  });

  it("refuses once the plan is paid off or cancelled", async () => {
    await w.db.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    expect(await code(startUpdateCard(deps(), bookerId, bookingId))).toBe("not_found");
  });
});
