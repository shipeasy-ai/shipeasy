import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only our own unit tests. Never the copied example app under .eval-workdir/
    // (its *.test.tsx would otherwise be collected and fail to resolve).
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".eval-workdir/**"],
  },
});
