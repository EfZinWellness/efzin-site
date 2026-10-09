import { describe, it, expect, vi, beforeEach } from "vitest";
import { poolConfig, resetPoolForTests } from "../../lib/db/pool";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
const REMOTE = "postgresql://postgres.ref:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

describe("pg pool TLS config", () => {
  beforeEach(() => resetPoolForTests());

  it("local database: no TLS", () => {
    const warn = vi.fn();
    for (const url of ["postgres://u:p@localhost:5432/db", "postgres://u:p@127.0.0.1:54322/postgres"]) {
      const c = poolConfig(url, { NODE_ENV: "production" }, warn);
      expect(c.ssl).toBeUndefined();
      expect(c.connectionString).toBe(url);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("remote with SUPABASE_DB_CA_CERT: verifies against that CA (\\n-escaped PEM accepted)", () => {
    const warn = vi.fn();
    const escaped = PEM.replace(/\n/g, "\\n");
    const c = poolConfig(REMOTE, { NODE_ENV: "production", SUPABASE_DB_CA_CERT: escaped }, warn);
    expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(poolConfig(REMOTE, { SUPABASE_DB_CA_CERT: PEM }, warn).ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("remote without the CA: still verifies (Node's default CAs) and warns once", () => {
    const warn = vi.fn();
    const c = poolConfig(REMOTE, { NODE_ENV: "production" }, warn);
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
    poolConfig(REMOTE, { NODE_ENV: "production" }, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("SUPABASE_DB_CA_CERT");
  });

  it("strips sslmode (and other ssl params) from the connection string so they cannot override the TLS settings", () => {
    const c = poolConfig(`${REMOTE}?sslmode=require&application_name=efzin&sslrootcert=x.crt`, { SUPABASE_DB_CA_CERT: PEM }, vi.fn());
    expect(c.connectionString).not.toMatch(/ssl/);
    expect(c.connectionString).toContain("application_name=efzin");
    expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("never turns certificate checks off", () => {
    for (const env of [{}, { NODE_ENV: "production" }, { SUPABASE_DB_CA_CERT: PEM }]) {
      const c = poolConfig(`${REMOTE}?sslmode=no-verify`, env, vi.fn());
      expect(c.ssl).toMatchObject({ rejectUnauthorized: true });
    }
  });
});
