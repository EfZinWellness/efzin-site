import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's "@/..." path alias (tsconfig), so route modules can be imported in tests.
  resolve: { alias: [{ find: /^@\//, replacement: `${process.cwd().replace(/\\/g, "/")}/` }] },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    passWithNoTests: true,
    // DB tests boot PGlite and run every migration per test; under parallel load that alone can pass 5 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
