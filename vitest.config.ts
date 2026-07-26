import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.{ts,mjs}", "packages/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
