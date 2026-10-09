import { describe, it, expect, beforeAll, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";

const h = vi.hoisted(() => ({ db: null as unknown, email: null as string | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentPerson: async () => (h.email ? { personId: "p", email: h.email, authUserId: null } : null),
}));
vi.mock("@/lib/db/client", () => ({ getSqlClient: async () => h.db }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadUpcoming, loadRevenue } from "@/lib/admin/upcoming";
import { loadGuestList } from "@/lib/admin/guests";
import { toggleCheckInDb } from "@/lib/admin/checkin";
import { searchPeople, loadPersonDetail } from "@/lib/admin/people";
import { loadRequests } from "@/lib/admin/requests";
import { loadAdminGiftCards } from "@/lib/admin/giftCards";
import { loadPaymentsDue } from "@/lib/admin/payments";
import { buildExport } from "@/lib/admin/export";
import { toggleCheckIn } from "@/app/admin/actions";
import { GET } from "@/app/admin/export/[kind]/route";
import { WAIVER_VERSION } from "@/lib/account/health";

let db: PGlite;
const ids: Record<string, string> = {};
const TODAY = "2026-10-09";
const NOW = new Date("2026-10-09T08:00:00Z");

async function one<T = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

async function person(key: string, name: string, email: string, phone: string | null = null) {
  ids[key] = (await one("insert into people (name, email, phone) values ($1, $2, $3) returning id", [name, email, phone])).id;
}

async function experience(key: string, slug: string, type: string, startOffsetDays: number, currency = "AED") {
  ids[key] = (
    await one(
      `insert into experiences (slug, type, title, status, base_currency, start_at, end_at)
       values ($1, $2, $3, 'on_sale', $4, now() + ($5 || ' days')::interval, now() + ($5 || ' days')::interval + interval '3 hours')
       returning id`,
      [slug, type, `Title ${slug}`, currency, String(startOffsetDays)],
    )
  ).id;
}

async function ticket(key: string, exp: string, capacity: number) {
  ids[key] = (
    await one("insert into ticket_types (experience_id, key, name, price_minor, capacity) values ($1, 'general', 'General', 10000, $2) returning id", [ids[exp], capacity])
  ).id;
}

async function booking(key: string, booker: string, exp: string, status: string, aed: number, gift = 0) {
  ids[key] = (
    await one(
      `insert into bookings (booker_person_id, experience_id, status, amount_aed_minor, gift_card_applied_aed_minor)
       values ($1, $2, $3, $4, $5) returning id`,
      [ids[booker], ids[exp], status, aed, gift],
    )
  ).id;
}

async function guest(key: string, b: string, p: string, t: string, isBooker: boolean, complete: boolean) {
  ids[key] = (
    await one(
      "insert into booking_guests (booking_id, person_id, ticket_type_id, is_booker, details_complete) values ($1, $2, $3, $4, $5) returning id",
      [ids[b], ids[p], ids[t], isBooker, complete],
    )
  ).id;
}

async function item(b: string, seq: number, dueOffset: number, amount: number, status: string, attempts = 0, attempted = false) {
  await db.query(
    `insert into payment_schedule_items (booking_id, seq, due_on, amount_minor, currency, status, attempts, first_attempted_at)
     values ($1, $2, $3::date + $4::int, $5, 'EUR', $6, $7, $8)`,
    [ids[b], seq, TODAY, dueOffset, amount, status, attempts, attempted ? new Date("2026-10-01T00:00:00Z") : null],
  );
}

beforeAll(async () => {
  db = await freshDb();
  h.db = db;
  await person("layla", "Layla Haddad", "layla@example.com", "+971500000001");
  await person("sara", "Sara Khan", "sara@example.com", "+971500000002");
  await person("noor", "=Noor Ali", "noor@example.com", "+971500000003");
  await person("rana", "Rana Said", "rana@example.com", "+971500000004");
  await db.query("update people set birthday = '1990-05-04', how_heard = 'Instagram', notes = 'Loves yoga' where id = $1", [ids.layla]);

  await experience("flow", "flow", "event", 5);
  await experience("greece", "greece", "retreat", 90, "EUR");
  await experience("old", "old-event", "event", -10);
  await ticket("t1", "flow", 10);
  await ticket("t2", "greece", 6);
  await ticket("t3", "old", 5);

  await booking("b1", "layla", "flow", "paid", 20000);
  await guest("g_layla", "b1", "layla", "t1", true, true);
  await guest("g_sara", "b1", "sara", "t1", false, false);
  await booking("b2", "noor", "flow", "deposit_paid", 5000, 1000);
  await guest("g_noor", "b2", "noor", "t1", true, true);
  await booking("b3", "rana", "flow", "cancelled", 9000);
  await guest("g_rana", "b3", "rana", "t1", true, true);
  await db.query("insert into holds (ticket_type_id, qty, expires_at) values ($1, 1, now() + interval '20 minutes')", [ids.t1]);

  await db.query(
    "insert into health_profiles (person_id, conditions, injuries, pregnancy, allergies, dietary, consent_at) values ($1, 'asthma', 'knee', true, 'nuts', 'vegan', now())",
    [ids.layla],
  );
  await db.query("insert into waivers (person_id, version) values ($1, $2)", [ids.layla, WAIVER_VERSION]);

  // Retreat bookings with payment schedules
  await booking("b4", "layla", "greece", "deposit_paid", 40000);
  await booking("b5", "sara", "greece", "deposit_paid", 40000);
  await booking("b6", "noor", "greece", "deposit_paid", 40000);
  await booking("b7", "rana", "greece", "cancelled", 40000);
  await item("b4", 0, -30, 5000, "paid", 1, true);
  await item("b4", 1, 10, 10000, "scheduled"); // due soon
  await item("b4", 2, 45, 20000, "scheduled"); // later than 30 days
  await item("b4", 3, -3, 15000, "failed", 1, true); // failed
  await item("b5", 1, -2, 12000, "scheduled", 0, false); // stuck: past due, never attempted
  await item("b6", 1, -1, 13000, "scheduled", 2, true); // repeated failures
  await item("b7", 1, 5, 99900, "cancelled"); // cancelled
  await item("b7", 2, 6, 88800, "scheduled"); // booking cancelled

  // Gift cards: sold 80000, outstanding 40000, expired 30000; a pending card counts for nothing
  const card = async (code: string, initial: number, status: string) =>
    (await one("insert into gift_cards (code, initial_aed_minor, balance_aed_minor, status, buyer_person_id, recipient_name, expires_at) values ($1, $2, 0, $3, $4, 'Friend', now() + interval '6 months') returning id", [code, initial, status, ids.layla])).id;
  const c1 = await card("EFZG-AAAA-AAAA", 50000, "active");
  const c2 = await card("EFZG-BBBB-BBBB", 30000, "expired");
  await card("EFZG-CCCC-CCCC", 10000, "pending_payment");
  await db.query("select gift_card_ledger_add($1, null, 50000, 'issue')", [c1]);
  await db.query("select gift_card_ledger_add($1, $2, -10000, 'redeem')", [c1, ids.b1]);
  await db.query("select gift_card_ledger_add($1, null, 30000, 'issue')", [c2]);
  await db.query("select gift_card_ledger_add($1, null, -30000, 'expiry')", [c2]);

  await db.query("insert into requests (type, payload, person_id) values ('private', '{\"groupSize\": 8}'::jsonb, $1)", [ids.layla]);
});

describe("upcoming experiences", () => {
  it("shows sold, remaining (holds count), revenue and missing details; omits past ones", async () => {
    const list = await loadUpcoming(db, NOW);
    expect(list.map((e) => e.slug)).toEqual(["flow", "greece"]);
    const flow = list.find((e) => e.slug === "flow")!;
    expect(flow.capacity).toBe(10);
    expect(flow.sold).toBe(3);
    expect(flow.remaining).toBe(6);
    expect(flow.revenueAedMinor).toBe(25000);
    expect(flow.missingDetails).toBe(1);
  });

  it("revenue is booking money only: gift card sales are excluded, gift applied is not added twice", async () => {
    const r = await loadRevenue(db);
    expect(r.experienceAedMinor).toBe(25000 + 3 * 40000);
    expect(r.giftSalesAedMinor).toBe(80000);
  });
});

describe("guest list", () => {
  it("lists paying guests with contact, waiver and health flags", async () => {
    const g = await loadGuestList(db, "flow");
    expect(g?.experience.title).toBe("Title flow");
    expect(g!.guests.map((x) => x.name).sort()).toEqual(["=Noor Ali", "Layla Haddad", "Sara Khan"]);
    const layla = g!.guests.find((x) => x.name === "Layla Haddad")!;
    expect(layla.phone).toBe("+971500000001");
    expect(layla.waiver).toBe(true);
    expect(layla.health).toMatchObject({ conditions: "asthma", injuries: "knee", pregnancy: true, allergies: "nuts", dietary: "vegan" });
    const sara = g!.guests.find((x) => x.name === "Sara Khan")!;
    expect(sara.waiver).toBe(false);
    expect(sara.detailsComplete).toBe(false);
    expect(sara.checkedIn).toBe(false);
  });

  it("returns null for an unknown experience", async () => {
    expect(await loadGuestList(db, "nope")).toBeNull();
  });
});

describe("check-in", () => {
  it("toggles and drives own_booking_count for the booker", async () => {
    const count = async () => (await one<{ c: number }>("select own_booking_count($1) as c", [ids.layla])).c;
    expect(await count()).toBe(0);
    expect(await toggleCheckInDb(db, ids.g_layla, NOW)).toEqual({ ok: true, checkedIn: true });
    expect(await count()).toBe(1);
    expect(await toggleCheckInDb(db, ids.g_layla, NOW)).toEqual({ ok: true, checkedIn: false });
    expect(await count()).toBe(0);
  });

  it("refuses cancelled bookings, bad ids and unknown guests", async () => {
    expect((await toggleCheckInDb(db, ids.g_rana, NOW)).ok).toBe(false);
    expect((await toggleCheckInDb(db, "not-a-uuid", NOW)).ok).toBe(false);
    expect((await toggleCheckInDb(db, "00000000-0000-4000-8000-000000000000", NOW)).ok).toBe(false);
    expect((await one<{ checked_in_at: string | null }>("select checked_in_at from booking_guests where id = $1", [ids.g_rana])).checked_in_at).toBeNull();
  });

  it("the server action re-checks admin before touching anything", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    h.email = "guest@example.com";
    expect((await toggleCheckIn(ids.g_sara)).ok).toBe(false);
    expect((await one<{ checked_in_at: string | null }>("select checked_in_at from booking_guests where id = $1", [ids.g_sara])).checked_in_at).toBeNull();
    h.email = null;
    expect((await toggleCheckIn(ids.g_sara)).ok).toBe(false);
    h.email = "BOSS@example.com";
    expect(await toggleCheckIn(ids.g_sara)).toEqual({ ok: true, checkedIn: true });
    expect(await toggleCheckIn(ids.g_sara)).toEqual({ ok: true, checkedIn: false });
  });
});

describe("people", () => {
  it("searches by name or email, with total spent and own booking count", async () => {
    const r = await searchPeople(db, "lay");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Layla Haddad", totalSpentAedMinor: 20000 + 40000, bookingCount: 2 });
    expect((await searchPeople(db, "SARA@EXAMPLE")).map((p) => p.name)).toEqual(["Sara Khan"]);
  });

  it("treats LIKE wildcards literally", async () => {
    expect(await searchPeople(db, "%")).toHaveLength(0);
    expect(await searchPeople(db, "_")).toHaveLength(0);
  });

  it("lists everybody for an empty search", async () => {
    expect((await searchPeople(db, "")).length).toBe(4);
  });

  it("loads a person's history", async () => {
    const d = await loadPersonDetail(db, ids.layla);
    expect(d).toMatchObject({ name: "Layla Haddad", howHeard: "Instagram", notes: "Loves yoga", birthday: "1990-05-04" });
    expect(d!.bookings.map((b) => b.slug).sort()).toEqual(["flow", "greece"]);
    expect(d!.totalSpentAedMinor).toBe(60000);
    expect(await loadPersonDetail(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await loadPersonDetail(db, "junk")).toBeNull();
  });
});

describe("requests", () => {
  it("lists requests with who sent them", async () => {
    const r = await loadRequests(db);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "private", personName: "Layla Haddad", payload: { groupSize: 8 } });
  });
});

describe("gift cards", () => {
  it("lists every card and totals match the ledger", async () => {
    const g = await loadAdminGiftCards(db);
    expect(g.cards).toHaveLength(3);
    expect(g.totals).toEqual({ salesAedMinor: 80000, outstandingAedMinor: 40000, expiredAedMinor: 30000 });
    const a = g.cards.find((c) => c.code === "EFZG-AAAA-AAAA")!;
    expect(a).toMatchObject({ initialAedMinor: 50000, balanceAedMinor: 40000, status: "active", buyerName: "Layla Haddad", recipientName: "Friend" });
  });
});

describe("payments due", () => {
  it("lists next-30-day items, failures and stuck items only", async () => {
    const p = await loadPaymentsDue(db, TODAY);
    expect(p.dueSoon.map((i) => i.amountMinor)).toEqual([10000]);
    const attention = Object.fromEntries(p.attention.map((i) => [i.amountMinor, i.reasons]));
    expect(Object.keys(attention).sort()).toEqual(["12000", "13000", "15000"]);
    expect(attention["15000"]).toContain("failed");
    expect(attention["12000"]).toContain("not_attempted");
    expect(attention["13000"]).toContain("repeated_failures");
    const failed = p.attention.find((i) => i.amountMinor === 15000)!;
    expect(failed).toMatchObject({ bookerName: "Layla Haddad", bookerEmail: "layla@example.com", bookerPhone: "+971500000001", attempts: 1 });
    // never the cancelled item, the cancelled booking, the paid deposit, or the item 45 days out
    const all = [...p.dueSoon, ...p.attention].map((i) => i.amountMinor);
    for (const bad of [5000, 20000, 99900, 88800]) expect(all).not.toContain(bad);
  });

  it("totals what is still to collect per retreat (active bookings, scheduled and failed)", async () => {
    const p = await loadPaymentsDue(db, TODAY);
    expect(p.toCollect).toEqual([
      { slug: "greece", title: "Title greece", currency: "EUR", totalMinor: 10000 + 20000 + 15000 + 12000 + 13000 },
    ]);
  });
});

describe("csv export", () => {
  it("people export has a header row and guards formulas", async () => {
    const e = await buildExport(db, "people", {});
    expect(e!.filename).toMatch(/^efzin-people-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(e!.csv.split("\r\n")[0]).toBe("name,email,phone,birthday,how_heard,marketing_consent,notes,created_at,total_spent_aed,bookings");
    expect(e!.csv).toContain("'=Noor Ali");
  });

  it("guest exports leave health out unless the kind is guests-health", async () => {
    const plain = await buildExport(db, "guests", { slug: "flow" });
    expect(plain!.csv).not.toMatch(/asthma|vegan|nuts|knee/);
    expect(plain!.csv.split("\r\n")[0]).not.toMatch(/conditions|allergies|dietary|injuries|pregnan/);
    const health = await buildExport(db, "guests-health", { slug: "flow" });
    expect(health!.csv).toContain("asthma");
    expect(health!.csv.split("\r\n")[0]).toMatch(/conditions/);
  });

  it("no other export carries health data", async () => {
    for (const kind of ["people", "bookings", "requests", "gift-cards", "payments-due"] as const) {
      const e = await buildExport(db, kind, {});
      expect(e, kind).not.toBeNull();
      expect(e!.csv, kind).not.toMatch(/asthma|vegan/);
    }
  });

  it("rejects unknown kinds and guests without a known experience", async () => {
    expect(await buildExport(db, "secrets", {})).toBeNull();
    expect(await buildExport(db, "guests", {})).toBeNull();
    expect(await buildExport(db, "guests", { slug: "nope" })).toBeNull();
  });

  const call = (kind: string, qs = "") =>
    GET(new Request(`http://localhost/admin/export/${kind}${qs}`), { params: Promise.resolve({ kind }) });

  it("the route answers 404 to non-admins and signed-out visitors", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    h.email = null;
    expect((await call("people")).status).toBe(404);
    h.email = "guest@example.com";
    expect((await call("people")).status).toBe(404);
  });

  it("the route serves text/csv with a BOM and a filename to the admin", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    h.email = "boss@example.com";
    const res = await call("people");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="efzin-people-.*\.csv"$/);
    // Response.text() strips a BOM, so check the raw bytes: EF BB BF then the header row.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).startsWith("﻿name,email")).toBe(true);
    expect((await call("nonsense")).status).toBe(404);
    expect((await call("guests-health", "?experience=flow")).status).toBe(200);
  });
});
