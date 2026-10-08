import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    passWithNoTests: true,
    // DB tests boot PGlite and run every migration per test; under parallel load that alone can pass 5 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
