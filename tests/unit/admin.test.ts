import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentPerson: async () =>
    session.email ? { personId: "p1", email: session.email, authUserId: null } : null,
}));

import { isAdmin, requireAdmin } from "@/lib/auth/admin";
import { CSV_BOM, csvCell, toCsv } from "@/lib/admin/csv";

describe("isAdmin", () => {
  const env = { ADMIN_EMAILS: " Tanya@EfZinWellness.com , second@example.com " } as unknown as NodeJS.ProcessEnv;

  it("matches case-insensitively and ignores surrounding spaces", () => {
    expect(isAdmin("tanya@efzinwellness.com", env)).toBe(true);
    expect(isAdmin("TANYA@efzinwellness.COM", env)).toBe(true);
    expect(isAdmin(" second@example.com ", env)).toBe(true);
  });

  it("is false for others, blanks and when nothing is configured", () => {
    expect(isAdmin("other@example.com", env)).toBe(false);
    expect(isAdmin("", env)).toBe(false);
    expect(isAdmin(null, env)).toBe(false);
    expect(isAdmin(undefined, env)).toBe(false);
    expect(isAdmin("tanya@efzinwellness.com", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(isAdmin("", { ADMIN_EMAILS: ",," } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    session.email = null;
  });

  it("answers 404 for a signed-out visitor", async () => {
    await expect(requireAdmin()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("answers 404 for a signed-in non-admin", async () => {
    session.email = "guest@example.com";
    await expect(requireAdmin()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("returns the admin", async () => {
    session.email = "Boss@Example.com";
    await expect(requireAdmin()).resolves.toMatchObject({ email: "Boss@Example.com" });
  });
});

describe("csv", () => {
  it("quotes cells with commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("renders null and undefined as empty, numbers and booleans plainly", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(true)).toBe("true");
  });

  it("neutralises formula injection with a single quote", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\t=x")).toBe("'\t=x");
    expect(csvCell("=1,2")).toBe('"\'=1,2"');
  });

  it("does not touch negative numbers given as numbers", () => {
    expect(csvCell(-5)).toBe("-5");
  });

  it("builds a header row and CRLF lines", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe("a,b\r\n1,\"x,y\"\r\n");
    expect(CSV_BOM).toBe("﻿");
  });
});
