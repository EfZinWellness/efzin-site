import type { Pool } from "pg";

let poolPromise: Promise<Pool> | null = null;

/**
 * One shared, lazily created pool for the whole server process. The creation promise is
 * cached so concurrent first callers cannot create two pools. An 'error' listener is
 * required: an idle client dropping would otherwise be an unhandled 'error' event.
 */
export function getPool(url: string): Promise<Pool> {
  poolPromise ??= import("pg").then(({ Pool: PgPool }) => {
    const p = new PgPool({ connectionString: url, max: 3, connectionTimeoutMillis: 3000 });
    p.on("error", (err) => console.error("pg pool error", err));
    return p;
  });
  return poolPromise;
}

/** Test-only: forget the cached pool. */
export function resetPoolForTests(): void {
  poolPromise = null;
}