/** Best-effort in-memory sliding-window counter (per server instance). */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const prune = (now: number) => {
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  };
  return {
    /** True when the key has used up its allowance in the window. */
    blocked(key: string, now = Date.now()): boolean {
      return recent(key, now).length >= max;
    },
    /** Counts one hit. */
    record(key: string, now = Date.now()): void {
      const r = recent(key, now);
      r.push(now);
      hits.set(key, r);
      prune(now);
    },
    reset(): void {
      hits.clear();
    },
  };
}

const requests = createLimiter(5, 10 * 60 * 1000);

/** Returns true when the request is allowed (5 per 10 minutes per key), and counts it. */
export function allowRequest(key: string, now = Date.now()): boolean {
  if (requests.blocked(key, now)) return false;
  requests.record(key, now);
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function resetThrottleForTests(): void {
  requests.reset();
}
