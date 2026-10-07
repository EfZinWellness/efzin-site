import { describe, it, expect, vi, beforeEach } from "vitest";

const ctor = vi.fn();
const on = vi.fn();

vi.mock("pg", () => ({
  Pool: class {
    constructor(opts: unknown) {
      ctor(opts);
    }
    on = on;
  },
}));

import { getPool, resetPoolForTests } from "../../lib/booking/availability";

describe("shared pg pool", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    resetPoolForTests();
    ctor.mockClear();
    on.mockClear();
  });

  it("creates one pool for concurrent callers and registers an error listener", async () => {
    const [a, b] = await Promise.all([getPool("postgres://x"), getPool("postgres://x")]);
    expect(a).toBe(b);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
