import type { Pool, PoolConfig } from "pg";

let poolPromise: Promise<Pool> | null = null;
let warnedNoCa = false;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Connection-string parameters that pg-connection-string turns into TLS settings (they would override ours). */
const SSL_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslpassword", "uselibpqcompat"];

/**
 * The pool settings for `url`. A local database (localhost / 127.0.0.1) gets no TLS. Anything else
 * (Supabase) is always TLS with the certificate checked: against SUPABASE_DB_CA_CERT (Supabase's
 * CA, PEM text; `\n`-escaped is fine) when set, otherwise against Node's default CAs with a
 * one-time warning. Certificate checks are never turned off. TLS parameters in the connection
 * string are removed so they cannot override these settings.
 */
export function poolConfig(
  url: string,
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = console.warn,
): PoolConfig {
  let connectionString = url;
  let host = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    if (SSL_PARAMS.some((p) => u.searchParams.has(p))) {
      for (const p of SSL_PARAMS) u.searchParams.delete(p);
      connectionString = u.toString();
    }
  } catch {
    // Not a URL we can read: treated as remote, so TLS with verification applies.
  }
  const base: PoolConfig = { connectionString, max: 3, connectionTimeoutMillis: 3000 };
  if (LOCAL_HOSTS.has(host)) return base;
  const ca = env.SUPABASE_DB_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (ca) return { ...base, ssl: { ca, rejectUnauthorized: true } };
  if (!warnedNoCa) {
    warnedNoCa = true;
    warn(
      "[db] SUPABASE_DB_CA_CERT is not set: connecting with TLS verified against Node's default CAs. " +
        "Set it to Supabase's CA certificate (docs/launch-runbook.md) or the connection may be refused.",
    );
  }
  return { ...base, ssl: { rejectUnauthorized: true } };
}

/**
 * One shared, lazily created pool for the whole server process. The creation promise is
 * cached so concurrent first callers cannot create two pools. An 'error' listener is
 * required: an idle client dropping would otherwise be an unhandled 'error' event.
 */
export function getPool(url: string): Promise<Pool> {
  poolPromise ??= import("pg").then(({ Pool: PgPool }) => {
    const p = new PgPool(poolConfig(url));
    p.on("error", (err) => console.error("pg pool error", err));
    return p;
  });
  return poolPromise;
}

/** Test-only: forget the cached pool (and the one-time warning). */
export function resetPoolForTests(): void {
  poolPromise = null;
  warnedNoCa = false;
}
