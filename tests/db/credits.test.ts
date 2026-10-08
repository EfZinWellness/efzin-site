import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { issueCredit, findUsableCredit, redeemCredit } from "../../lib/credits/db";
import { creditExpiry } from "../../lib/policy/credit";

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

async function setup() {
  const p = (
    await one<{ id: string }>("insert into people (name, email) values ('P', 'p@example.com') returning id")
  ).id;
  const exp = await one<{ id: string }>(
    `insert into experiences (slug, type, title, status, base_currency, start_at, end_at)
     values ('e-' || gen_random_uuid(), 'event', 'T', 'on_sale', 'AED', now(), now()) returning id`,
  );
  const mk = async () =>
    (
      await one<{ id: string }>(
        "insert into bookings (booker_person_id, experience_id, status) values ($1, $2, 'paid') returning id",
        [p, exp.id],
      )
    ).id;
  return { p, src: await mk(), use: await mk() };
}

beforeEach(async () => {
  db = await freshDb();
});

describe("credits", () => {
  const now = new Date("2026-10-08T10:00:00Z");

  it("issues a credit with an EFZ- code and 12 month expiry", async () => {
    const { p, src } = await setup();
    const c = await issueCredit(db, p, 20000, src, now);
    expect(c.code).toMatch(/^EFZ-[A-HJ-NP-Z2-9]{6}$/);
    const row = await one<{ amount_aed_minor: number; expires_at: string; person_id: string }>(
      "select * from credits where id = $1",
      [c.id],
    );
    expect(row.amount_aed_minor).toBe(20000);
    expect(new Date(row.expires_at).toISOString()).toBe(creditExpiry(now).toISOString());
  });

  it("finds a usable credit by loosely typed code; not expired or redeemed ones", async () => {
    const { p, src, use } = await setup();
    const c = await issueCredit(db, p, 20000, src, now);
    const loose = c.code.toLowerCase().replace("-", " ");
    expect((await findUsableCredit(db, loose, now))?.id).toBe(c.id);
    expect(await findUsableCredit(db, c.code, new Date("2027-10-08T10:00:00Z"))).toBeNull();
    expect(await findUsableCredit(db, "EFZ-NOPE22", now)).toBeNull();
    await redeemCredit(db, c.id, use, 20000, now);
    expect(await findUsableCredit(db, c.code, now)).toBeNull();
  });

  it("redeeming in full leaves no new credit", async () => {
    const { p, src, use } = await setup();
    const c = await issueCredit(db, p, 20000, src, now);
    const r = await redeemCredit(db, c.id, use, 20000, now);
    expect(r.leftover).toBeNull();
    const row = await one<{ redeemed_booking_id: string }>("select redeemed_booking_id from credits where id = $1", [c.id]);
    expect(row.redeemed_booking_id).toBe(use);
  });

  it("partial redeem issues a leftover credit with the same expiry", async () => {
    const { p, src, use } = await setup();
    const c = await issueCredit(db, p, 20000, src, now);
    const later = new Date("2026-12-01T00:00:00Z");
    const r = await redeemCredit(db, c.id, use, 5000, later);
    expect(r.leftover).not.toBeNull();
    expect(r.leftover!.code).toMatch(/^EFZ-/);
    expect(r.leftover!.code).not.toBe(c.code);
    const orig = await one<{ expires_at: string }>("select expires_at from credits where id = $1", [c.id]);
    const left = await one<{ amount_aed_minor: number; expires_at: string; redeemed_booking_id: string | null; person_id: string }>(
      "select * from credits where id = $1",
      [r.leftover!.id],
    );
    expect(left.amount_aed_minor).toBe(15000);
    expect(new Date(left.expires_at).toISOString()).toBe(new Date(orig.expires_at).toISOString());
    expect(left.redeemed_booking_id).toBeNull();
    expect(left.person_id).toBe(p);
  });

  it("refuses an already used, expired or over-spent credit", async () => {
    const { p, src, use } = await setup();
    const c = await issueCredit(db, p, 20000, src, now);
    await expect(redeemCredit(db, c.id, use, 30000, now)).rejects.toThrow(/CREDIT/);
    await expect(redeemCredit(db, c.id, use, 100, new Date("2027-10-09T00:00:00Z"))).rejects.toThrow(/CREDIT/);
    await redeemCredit(db, c.id, use, 20000, now);
    await expect(redeemCredit(db, c.id, use, 100, now)).rejects.toThrow(/CREDIT/);
  });
});
