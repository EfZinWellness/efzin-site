import { describe, it, expect, vi, afterEach } from "vitest";
import { RequestSchema } from "../../lib/requests/schema";
import { handleRequest, handleNewsletter } from "../../lib/requests/handlers";
import { redirects } from "../../redirects";
import { sendEmail, setEmailTransport } from "../../lib/email/send";
import type { SqlClient } from "../../lib/content/sync";

const corporate = {
  type: "corporate",
  name: "Nadia Haddad",
  email: "nadia@acme.com",
  phone: "+971500000000",
  whoFor: "team",
  where: "dubai_half_day",
  groupSize: 25,
  interests: ["move", "thrive"],
  budget: { amount: 5000, currency: "AED", basis: "total" },
  company: "Acme",
  teamSize: 25,
  goals: ["stress", "team bonding"],
  invoiceContact: "finance@acme.com",
};

describe("RequestSchema", () => {
  it("accepts a corporate payload", () => {
    expect(RequestSchema.safeParse(corporate).success).toBe(true);
  });

  it("rejects a missing email", () => {
    const rest: Record<string, unknown> = { ...corporate };
    delete rest.email;
    expect(RequestSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts a payload with no budget, and a retreat interest with a slug", () => {
    const rest: Record<string, unknown> = { ...corporate };
    delete rest.budget;
    expect(RequestSchema.safeParse(rest).success).toBe(true);
    expect(
      RequestSchema.safeParse({ type: "retreat_interest", name: "A", email: "a@b.co", slug: "aegean" }).success,
    ).toBe(true);
  });

  it("rejects corporate without company details and an unknown budget basis", () => {
    expect(RequestSchema.safeParse({ ...corporate, company: undefined }).success).toBe(false);
    expect(
      RequestSchema.safeParse({ ...corporate, budget: { amount: 1, currency: "AED", basis: "weekly" } }).success,
    ).toBe(false);
  });
});

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: SqlClient = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rows: [{ id: "person-1" }] as never[] };
    },
  };
  return { db, calls };
}

describe("handleRequest", () => {
  it("returns 400 with issues for invalid input", async () => {
    const send = vi.fn();
    const r = await handleRequest({ type: "private", name: "A" }, { db: null, sendEmail: send });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(Array.isArray(r.body.issues)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("without a database still validates, emails Tanya and reports stored:false", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await handleRequest(corporate, { db: null, sendEmail: send });
    expect(r).toEqual({ status: 200, body: { ok: true, stored: false } });
    expect(send).toHaveBeenCalledWith("request_received", expect.any(String), expect.objectContaining({ type: "corporate" }));
  });

  it("with a database upserts the person, inserts the request and emails", async () => {
    const { db, calls } = fakeDb();
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await handleRequest(corporate, { db, sendEmail: send });
    expect(r).toEqual({ status: 200, body: { ok: true, stored: true } });
    const insert = calls.find((c) => /insert into requests/i.test(c.sql));
    expect(insert?.params[0]).toBe("corporate");
    expect(insert?.params[2]).toBe("person-1");
    expect(JSON.parse(insert?.params[1] as string).company).toBe("Acme");
    expect(send).toHaveBeenCalledOnce();
  });

  it("still succeeds when the email fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleRequest(corporate, { db: null, sendEmail: send });
    expect(r.status).toBe(200);
  });

  it("returns 500 when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db: SqlClient = { query: () => Promise.reject(new Error("down")) };
    const r = await handleRequest(corporate, { db, sendEmail: vi.fn() });
    expect(r.status).toBe(500);
  });
});

describe("handleNewsletter", () => {
  it("rejects a bad email", async () => {
    const r = await handleNewsletter({ email: "nope" }, { db: null });
    expect(r.status).toBe(400);
  });

  it("without a database returns stored:false", async () => {
    expect(await handleNewsletter({ email: "a@b.co" }, { db: null })).toEqual({
      status: 200,
      body: { ok: true, stored: false },
    });
  });

  it("upserts then records marketing consent", async () => {
    const { db, calls } = fakeDb();
    const r = await handleNewsletter({ name: "Layla", email: "a@b.co" }, { db });
    expect(r.body).toEqual({ ok: true, stored: true });
    const upd = calls.find((c) => /marketing_consent\s*=\s*true/i.test(c.sql));
    expect(upd?.params).toEqual(["person-1"]);
  });
});

describe("redirects", () => {
  const find = (s: string) => redirects.find((r) => r.source === s);
  it("are 301s", () => {
    expect(redirects.length).toBeGreaterThan(8);
    for (const r of redirects) expect(r.statusCode).toBe(301);
  });
  it("map the old Squarespace paths", () => {
    expect(find("/ef-zin-retreats-1")?.destination).toBe("/events");
    expect(find("/faqs")?.destination).toBe("/faq");
    expect(find("/privacy-policy-1")?.destination).toBe("/privacy");
    expect(find("/privacy-policy-1-1")?.destination).toBe("/privacy");
    for (const s of ["/ef-zin-retreats", "/past-events", "/past-retreats", "/forms", "/interestform"]) {
      expect(find(s)).toBeTruthy();
    }
  });
  it("sends the Strong Body Calm Mind store pages to the event, before the /store/p catch-all", () => {
    const dest = "/events/2026-10-04-strong-body-calm-mind";
    expect(find("/store/p/strongbody-calmmind-re")?.destination).toBe(dest);
    expect(find("/store/p/strongbody-calmmind-re-k2dhd")?.destination).toBe(dest);
    const i = redirects.findIndex((r) => r.source === "/store/p/:path*");
    expect(i).toBeGreaterThan(redirects.findIndex((r) => r.source === "/store/p/strongbody-calmmind-re-k2dhd"));
  });
});

describe("sendEmail", () => {
  afterEach(() => {
    setEmailTransport(null);
    delete process.env.ADMIN_EMAILS;
  });

  it("routes admin kinds to ADMIN_EMAILS", async () => {
    process.env.ADMIN_EMAILS = "a@x.com, b@x.com";
    const t = vi.fn().mockResolvedValue(undefined);
    setEmailTransport(t);
    await sendEmail("request_received", "fallback@x.com", { type: "private" });
    expect(t.mock.calls[0][0].to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("sends guest kinds to the given address", async () => {
    process.env.ADMIN_EMAILS = "a@x.com";
    const t = vi.fn().mockResolvedValue(undefined);
    setEmailTransport(t);
    await sendEmail("booking_confirmed", "guest@x.com", {});
    expect(t.mock.calls[0][0].to).toEqual(["guest@x.com"]);
  });

  it("logs instead of throwing when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(sendEmail("admin_error", "x@x.com", {})).resolves.toBeUndefined();
    expect(info).toHaveBeenCalled();
  });
});