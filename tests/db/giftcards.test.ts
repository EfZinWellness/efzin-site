import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import {
  issueGiftCards,
  activateGiftCards,
  reserveGiftCard,
  redeemReservation,
  releaseReservation,
  returnToGiftCard,
  voidIfUnused,
  expireGiftCards,
  getGiftBalance,
} from "../../lib/giftcards/db";
import { isGiftCode } from "../../lib/giftcards/code";

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

async function person(email: string, authUserId: string | null = null) {
  return (
    await one<{ id: string }>(
      "insert into people (name, email, auth_user_id) values ('P', $1, $2) returning id",
      [email, authUserId],
    )
  ).id;
}

async function booking(personId: string) {
  const exp = await one<{ id: string }>(
    `insert into experiences (slug, type, title, status, base_currency, start_at, end_at)
     values ('e-' || gen_random_uuid(), 'event', 'T', 'on_sale', 'AED', now(), now()) returning id`,
  );
  return (
    await one<{ id: string }>(
      "insert into bookings (booker_person_id, experience_id, status) values ($1, $2, 'paid') returning id",
      [personId, exp.id],
    )
  ).id;
}

async function pending() {
  return (
    await one<{ id: string }>(
      "insert into pending_bookings (kind, payload) values ('booking', '{}'::jsonb) returning id",
    )
  ).id;
}

const FUTURE = () => new Date(Date.now() + 30 * 60_000);

async function activeCard(buyer: string, aed = 50000, pi = "pi_1") {
  const [c] = await issueGiftCards(db, {
    count: 1,
    initialAedMinor: aed,
    buyerPersonId: buyer,
    deliverOn: "2026-10-08",
    paymentRef: pi,
  });
  await activateGiftCards(db, pi);
  return c;
}

beforeEach(async () => {
  db = await freshDb();
});

describe("gift card lifecycle", () => {
  it("a newly issued card is pending with balance 0 and cannot be reserved", async () => {
    const buyer = await person("b@example.com");
    const [c] = await issueGiftCards(db, {
      count: 1,
      initialAedMinor: 50000,
      buyerPersonId: buyer,
      deliverOn: "2026-10-08",
      paymentRef: "pi_1",
    });
    expect(isGiftCode(c.code)).toBe(true);
    const bal = await getGiftBalance(db, c.code);
    expect(bal?.status).toBe("pending_payment");
    expect(bal?.balanceAedMinor).toBe(0);
    await expect(reserveGiftCard(db, c.code, 100, await pending(), FUTURE())).rejects.toThrow(/GIFT_INVALID/);
  });

  it("issues several distinct codes sharing a batch", async () => {
    const buyer = await person("b@example.com");
    const cards = await issueGiftCards(db, {
      count: 3,
      initialAedMinor: 25000,
      buyerPersonId: buyer,
      deliverOn: "2026-10-08",
      paymentRef: "pi_bulk",
    });
    expect(new Set(cards.map((c) => c.code)).size).toBe(3);
    const rows = await db.query<{ purchase_batch_id: string }>("select purchase_batch_id from gift_cards");
    expect(new Set(rows.rows.map((r) => r.purchase_batch_id)).size).toBe(1);
    expect(rows.rows[0].purchase_batch_id).toBeTruthy();
  });

  it("activation sets the balance to the initial value, writes an issue ledger row and sets expiry", async () => {
    const buyer = await person("b@example.com");
    const c = await activeCard(buyer);
    const bal = await getGiftBalance(db, c.id);
    expect(bal?.status).toBe("active");
    expect(bal?.balanceAedMinor).toBe(50000);
    const led = await db.query<{ amount_aed_minor: number; reason: string }>(
      "select amount_aed_minor, reason from gift_card_ledger where gift_card_id = $1",
      [c.id],
    );
    expect(led.rows).toEqual([{ amount_aed_minor: 50000, reason: "issue" }]);
    expect(bal?.expiresAt).toBeTruthy();
  });

  it("reserve_gift_card refuses beyond available balance", async () => {
    const c = await activeCard(await person("b@example.com"));
    await reserveGiftCard(db, c.code, 30000, await pending(), FUTURE());
    await expect(reserveGiftCard(db, c.code, 30000, await pending(), FUTURE())).rejects.toThrow(/GIFT_INSUFFICIENT/);
    expect((await getGiftBalance(db, c.id))?.availableAedMinor).toBe(20000);
  });

  it("an unknown code is GIFT_INVALID", async () => {
    await expect(reserveGiftCard(db, "EFZG-AAAA-BBBB", 100, await pending(), FUTURE())).rejects.toThrow(/GIFT_INVALID/);
  });

  it("an expired reservation no longer counts; a released one neither", async () => {
    const c = await activeCard(await person("b@example.com"));
    const r1 = await reserveGiftCard(db, c.code, 30000, await pending(), FUTURE());
    await db.query("update gift_card_reservations set expires_at = now() - interval '1 minute' where id = $1", [r1]);
    expect((await getGiftBalance(db, c.id))?.availableAedMinor).toBe(50000);
    const r2 = await reserveGiftCard(db, c.code, 50000, await pending(), FUTURE());
    await releaseReservation(db, r2);
    expect((await getGiftBalance(db, c.id))?.availableAedMinor).toBe(50000);
  });

  it("an expired card raises GIFT_EXPIRED; a void card GIFT_INVALID", async () => {
    const c = await activeCard(await person("b@example.com"));
    await db.query("update gift_cards set expires_at = now() - interval '1 day' where id = $1", [c.id]);
    await expect(reserveGiftCard(db, c.code, 100, await pending(), FUTURE())).rejects.toThrow(/GIFT_EXPIRED/);
    await db.query("update gift_cards set expires_at = now() + interval '1 day', status = 'void' where id = $1", [c.id]);
    await expect(reserveGiftCard(db, c.code, 100, await pending(), FUTURE())).rejects.toThrow(/GIFT_INVALID/);
  });

  it("accepts the code in loose formatting", async () => {
    const c = await activeCard(await person("b@example.com"));
    const loose = c.code.toLowerCase().replace(/-/g, " ");
    await expect(reserveGiftCard(db, loose, 100, await pending(), FUTURE())).resolves.toBeTruthy();
  });

  it("redeem writes a negative ledger row, releases the reservation and links the recipient on first use", async () => {
    const buyer = await person("b@example.com");
    const friend = await person("f@example.com");
    const c = await activeCard(buyer);
    const bk = await booking(friend);
    const res = await reserveGiftCard(db, c.code, 30000, await pending(), FUTURE());
    await redeemReservation(db, res, bk);

    const bal = await getGiftBalance(db, c.id);
    expect(bal?.balanceAedMinor).toBe(20000);
    expect(bal?.availableAedMinor).toBe(20000);
    const sum = await one<{ s: number }>("select sum(amount_aed_minor)::int s from gift_card_ledger where gift_card_id = $1", [c.id]);
    expect(sum.s).toBe(20000);
    const spent = await one<{ amount_aed_minor: number; booking_id: string }>(
      "select amount_aed_minor, booking_id from gift_card_ledger where reason = 'redeem'",
    );
    expect(spent).toEqual({ amount_aed_minor: -30000, booking_id: bk });
    const row = await one<{ recipient_person_id: string }>("select recipient_person_id from gift_cards where id = $1", [c.id]);
    expect(row.recipient_person_id).toBe(friend);

    // a second redeem of the same reservation is refused
    await expect(redeemReservation(db, res, bk)).rejects.toThrow(/RESERVATION/);
  });

  it("the first user stays the recipient", async () => {
    const buyer = await person("b@example.com");
    const f1 = await person("f1@example.com");
    const f2 = await person("f2@example.com");
    const c = await activeCard(buyer);
    await redeemReservation(db, await reserveGiftCard(db, c.code, 100, await pending(), FUTURE()), await booking(f1));
    await redeemReservation(db, await reserveGiftCard(db, c.code, 100, await pending(), FUTURE()), await booking(f2));
    const row = await one<{ recipient_person_id: string }>("select recipient_person_id from gift_cards where id = $1", [c.id]);
    expect(row.recipient_person_id).toBe(f1);
  });

  it("returnToGiftCard restores balance", async () => {
    const buyer = await person("b@example.com");
    const c = await activeCard(buyer);
    const bk = await booking(buyer);
    await redeemReservation(db, await reserveGiftCard(db, c.code, 30000, await pending(), FUTURE()), bk);
    await returnToGiftCard(db, c.id, bk, 10000);
    const bal = await getGiftBalance(db, c.id);
    expect(bal?.balanceAedMinor).toBe(30000);
    const r = await one<{ reason: string }>("select reason from gift_card_ledger order by created_at desc, reason limit 1");
    expect(["refund_return", "redeem"]).toContain(r.reason);
    const n = await one<{ n: number }>("select count(*)::int n from gift_card_ledger where reason = 'refund_return'");
    expect(n.n).toBe(1);
  });

  it("voidIfUnused voids unused cards and reports partly_used otherwise", async () => {
    const buyer = await person("b@example.com");
    const unused = await activeCard(buyer, 50000, "pi_unused");
    expect(await voidIfUnused(db, "pi_unused")).toBe("voided");
    const v = await getGiftBalance(db, unused.id);
    expect(v?.status).toBe("void");
    expect(v?.balanceAedMinor).toBe(0);

    const used = await activeCard(buyer, 50000, "pi_used");
    await redeemReservation(db, await reserveGiftCard(db, used.code, 100, await pending(), FUTURE()), await booking(buyer));
    expect(await voidIfUnused(db, "pi_used")).toBe("partly_used");
    expect((await getGiftBalance(db, used.id))?.status).toBe("active");
  });

  it("voidIfUnused also voids a still-pending card", async () => {
    const buyer = await person("b@example.com");
    const [c] = await issueGiftCards(db, {
      count: 1, initialAedMinor: 1000, buyerPersonId: buyer, deliverOn: "2026-10-08", paymentRef: "pi_p",
    });
    expect(await voidIfUnused(db, "pi_p")).toBe("voided");
    expect((await getGiftBalance(db, c.id))?.status).toBe("void");
  });

  it("activation after void does not resurrect the card", async () => {
    const buyer = await person("b@example.com");
    const c = await activeCard(buyer, 1000, "pi_v");
    await voidIfUnused(db, "pi_v");
    await activateGiftCards(db, "pi_v");
    expect((await getGiftBalance(db, c.id))?.status).toBe("void");
  });

  it("expireGiftCards zeroes the balance with an expiry ledger row", async () => {
    const buyer = await person("b@example.com");
    const c = await activeCard(buyer);
    const fresh = await activeCard(buyer, 1000, "pi_2");
    await db.query("update gift_cards set expires_at = '2027-01-01T00:00:00Z' where id = $1", [c.id]);
    await db.query("update gift_cards set expires_at = '2030-01-01T00:00:00Z' where id = $1", [fresh.id]);

    expect(await expireGiftCards(db, new Date("2027-02-01T00:00:00Z"))).toBe(1);
    const bal = await getGiftBalance(db, c.id);
    expect(bal?.status).toBe("expired");
    expect(bal?.balanceAedMinor).toBe(0);
    const e = await one<{ amount_aed_minor: number }>(
      "select amount_aed_minor from gift_card_ledger where gift_card_id = $1 and reason = 'expiry'",
      [c.id],
    );
    expect(e.amount_aed_minor).toBe(-50000);
    expect((await getGiftBalance(db, fresh.id))?.status).toBe("active");
    // idempotent
    expect(await expireGiftCards(db, new Date("2027-02-01T00:00:00Z"))).toBe(0);
  });
});

describe("rev 2 row level security", () => {
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false)`);
    await db.exec("set role authenticated");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }

  it("members see gift cards where they are buyer or recipient, and schedule items of their bookings", async () => {
    const uA = "00000000-0000-0000-0000-00000000000a";
    const uB = "00000000-0000-0000-0000-00000000000b";
    for (const u of [uA, uB]) await db.query("insert into auth.users (id, email) values ($1, $2)", [u, `${u}@x.com`]);
    const a = await person("a@example.com", uA);
    const b = await person("b@example.com", uB);
    const other = await person("o@example.com");

    const cardAB = await activeCard(a, 1000, "pi_a"); // A buys
    const cardBO = await activeCard(b, 1000, "pi_b"); // B buys
    const cardOO = await activeCard(other, 1000, "pi_o"); // other buys
    await db.query("update gift_cards set recipient_person_id = $1 where id = $2", [a, cardBO.id]); // A receives B's
    void cardAB; void cardOO;

    const bkA = await booking(a);
    const bkO = await booking(other);
    for (const bk of [bkA, bkO]) {
      await db.query(
        "insert into payment_schedule_items (booking_id, seq, due_on, amount_minor, currency) values ($1, 0, '2026-10-08', 100, 'EUR')",
        [bk],
      );
    }

    const aCards = await asUser(uA, async () => (await db.query<{ id: string }>("select id from gift_cards")).rows);
    expect(aCards.map((r) => r.id).sort()).toEqual([cardAB.id, cardBO.id].sort());
    const bCards = await asUser(uB, async () => (await db.query<{ id: string }>("select id from gift_cards")).rows);
    expect(bCards.map((r) => r.id)).toEqual([cardBO.id]);

    const aItems = await asUser(uA, async () => (await db.query<{ booking_id: string }>("select booking_id from payment_schedule_items")).rows);
    expect(aItems.map((r) => r.booking_id)).toEqual([bkA]);

    await asUser(uA, async () => {
      for (const t of ["gift_card_ledger", "gift_card_reservations", "pending_bookings", "gift_card_batches"]) {
        await expect(db.query(`select * from ${t}`)).rejects.toThrow();
      }
      await expect(db.query("update gift_cards set message = 'x'")).rejects.toThrow();
      await expect(db.query("select reserve_gift_card('x', 1, gen_random_uuid(), now())")).rejects.toThrow();
    });
  });
});
