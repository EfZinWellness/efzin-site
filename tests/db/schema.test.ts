import { describe, it, expect, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function person(email: string, name = "P", authUserId: string | null = null) {
  const r = await one<{ id: string }>(
    "insert into people (name, email, auth_user_id) values ($1, $2, $3) returning id",
    [name, email, authUserId],
  );
  return r.id;
}

async function experience() {
  const r = await one<{ id: string }>(
    `insert into experiences (slug, type, title, status, base_currency, start_at, end_at)
     values ('exp-' || gen_random_uuid(), 'event', 'Test', 'on_sale', 'AED', now() + interval '10 days', now() + interval '10 days 3 hours')
     returning id`,
  );
  return r.id;
}

async function ticket(experienceId: string, capacity: number) {
  const r = await one<{ id: string }>(
    "insert into ticket_types (experience_id, key, name, price_minor, capacity) values ($1, 'ga', 'GA', 10000, $2) returning id",
    [experienceId, capacity],
  );
  return r.id;
}

async function booking(personId: string, experienceId: string, opts: { status?: string; imported?: boolean } = {}) {
  const r = await one<{ id: string }>(
    `insert into bookings (booker_person_id, experience_id, status, imported)
     values ($1, $2, $3, $4) returning id`,
    [personId, experienceId, opts.status ?? "paid", opts.imported ?? false],
  );
  return r.id;
}

async function guest(
  bookingId: string,
  personId: string,
  ticketTypeId: string,
  isBooker: boolean,
  checkedIn = false,
) {
  await db.query(
    `insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker, checked_in_at)
     values ($1, $2, $3, $4, $5)`,
    [bookingId, personId, ticketTypeId, isBooker, checkedIn ? new Date().toISOString() : null],
  );
}

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await db.exec(
    `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false)`,
  );
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

beforeEach(async () => {
  db = await freshDb();
});

describe("holds and availability", () => {
  it("create_hold succeeds for qty <= available and decrements available_spots", async () => {
    const t = await ticket(await experience(), 5);
    expect((await one<{ n: number }>("select available_spots($1) as n", [t])).n).toBe(5);
    const h = await one<{ id: string }>(
      "select create_hold($1, 2, now() + interval '31 minutes') as id",
      [t],
    );
    expect(h.id).toBeTruthy();
    expect((await one<{ n: number }>("select available_spots($1) as n", [t])).n).toBe(3);
  });

  it("create_hold raises SOLD_OUT when qty > available", async () => {
    const t = await ticket(await experience(), 2);
    await expect(
      db.query("select create_hold($1, 3, now() + interval '31 minutes')", [t]),
    ).rejects.toThrow(/SOLD_OUT/);
  });

  it("on a 1-spot ticket the first hold succeeds and the second raises SOLD_OUT", async () => {
    const t = await ticket(await experience(), 1);
    await db.query("select create_hold($1, 1, now() + interval '31 minutes')", [t]);
    await expect(
      db.query("select create_hold($1, 1, now() + interval '31 minutes')", [t]),
    ).rejects.toThrow(/SOLD_OUT/);
  });

  it("released holds free their spots; paid guests consume them", async () => {
    const exp = await experience();
    const t = await ticket(exp, 3);
    const h = await one<{ id: string }>(
      "select create_hold($1, 2, now() + interval '31 minutes') as id",
      [t],
    );
    await db.query("update holds set released_at = now() where id = $1", [h.id]);
    expect((await one<{ n: number }>("select available_spots($1) as n", [t])).n).toBe(3);

    const p = await person("a@example.com");
    const b = await booking(p, exp, { status: "paid" });
    await guest(b, p, t, true);
    const refunded = await booking(p, exp, { status: "refunded" });
    await guest(refunded, p, t, true);
    expect((await one<{ n: number }>("select available_spots($1) as n", [t])).n).toBe(2);
  });
});

describe("own_booking_count", () => {
  it("counts checked-in booker rows and imported bookings; ignores friend and unchecked rows", async () => {
    const exp = await experience();
    const t = await ticket(exp, 20);
    const me = await person("me@example.com");
    const friend = await person("friend@example.com");

    // checked-in booker row: counts
    const b1 = await booking(me, exp);
    await guest(b1, me, t, true, true);
    // unchecked booker row: ignored
    const b2 = await booking(me, exp);
    await guest(b2, me, t, true, false);
    // friend row on my booking, checked in: ignored for me (not booker)
    const b3 = await booking(me, exp);
    await guest(b3, friend, t, false, true);
    // imported booking, booker row not checked in: counts
    const b4 = await booking(me, exp, { imported: true });
    await guest(b4, me, t, true, false);
    // my attendance on a friend's booking (I am not the booker): ignored
    const b5 = await booking(friend, exp);
    await guest(b5, me, t, false, true);

    expect((await one<{ n: number }>("select own_booking_count($1) as n", [me])).n).toBe(2);
    expect((await one<{ n: number }>("select own_booking_count($1) as n", [friend])).n).toBe(0);
  });
});

describe("people", () => {
  it("email is unique case-insensitively", async () => {
    await person("layla@email.com");
    await expect(person("Layla@Email.com")).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("row level security", () => {
  it("members see only their own health_profiles and bookings", async () => {
    const userA = "00000000-0000-0000-0000-00000000000a";
    const userB = "00000000-0000-0000-0000-00000000000b";
    const userC = "00000000-0000-0000-0000-00000000000c";
    for (const u of [userA, userB, userC]) {
      await db.query("insert into auth.users (id, email) values ($1, $2)", [u, `${u}@example.com`]);
    }
    const a = await person("a@example.com", "A", userA);
    const b = await person("b@example.com", "B", userB);
    const c = await person("c@example.com", "C", userC);
    for (const p of [a, b, c]) {
      await db.query("insert into health_profiles (person_id, conditions) values ($1, 'secret')", [p]);
    }
    const exp = await experience();
    const t = await ticket(exp, 10);
    // A books for self; B books for C (C is a guest); B also has own booking
    const bkA = await booking(a, exp);
    await guest(bkA, a, t, true);
    const bkB = await booking(b, exp);
    await guest(bkB, b, t, true);
    await guest(bkB, c, t, false);

    const aHealth = await asUser(userA, async () =>
      (await db.query<{ person_id: string }>("select * from health_profiles")).rows,
    );
    expect(aHealth.map((r) => r.person_id)).toEqual([a]);

    const aBookings = await asUser(userA, async () =>
      (await db.query<{ id: string }>("select * from bookings")).rows,
    );
    expect(aBookings.map((r) => r.id)).toEqual([bkA]);

    // C is only a guest on B's booking and still sees it
    const cBookings = await asUser(userC, async () =>
      (await db.query<{ id: string }>("select * from bookings")).rows,
    );
    expect(cBookings.map((r) => r.id)).toEqual([bkB]);

    const aPeople = await asUser(userA, async () =>
      (await db.query<{ id: string }>("select id from people")).rows,
    );
    expect(aPeople.map((r) => r.id)).toEqual([a]);
  });

  it("members cannot write bookings and cannot change admin notes", async () => {
    const userA = "00000000-0000-0000-0000-00000000000a";
    await db.query("insert into auth.users (id, email) values ($1, 'a@example.com')", [userA]);
    const a = await person("a@example.com", "A", userA);
    const exp = await experience();

    await asUser(userA, async () => {
      await expect(
        db.query("insert into bookings (booker_person_id, experience_id, status) values ($1, $2, 'paid')", [a, exp]),
      ).rejects.toThrow();
      await expect(db.query("update people set notes = 'vip' where id = $1", [a])).rejects.toThrow();
      await db.query("update people set name = 'Alice' where id = $1", [a]);
    });
    expect((await one<{ name: string }>("select name from people where id = $1", [a])).name).toBe("Alice");
  });

  it("anon sees public experiences (not drafts) and ticket types but no people", async () => {
    const exp = await experience();
    await ticket(exp, 5);
    await db.query(
      `insert into experiences (slug, type, title, status, base_currency, start_at, end_at)
       values ('draft-one', 'event', 'Draft', 'draft', 'AED', now(), now())`,
    );
    await person("x@example.com");
    await db.exec("set role anon");
    try {
      expect((await db.query("select * from experiences")).rows).toHaveLength(1);
      expect((await db.query("select * from ticket_types")).rows).toHaveLength(1);
      await expect(db.query("select * from people")).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });
});
