import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        main: path.join(import.meta.dirname, "src/index.ts"),
        miniflare: {
          bindings: {
            ACCESS_AUD: "",
            ACCESS_TEAM_DOMAIN: "",
            APP_ENV: "test",
            DEV_AUTH_SUBJECT: "studymix-integration-tests",
            LEGAL_CONTACT_EMAIL: "privacy@example.test",
            GENERATION_PROVIDER: "mock",
            REAL_GENERATION_ENABLED: "false",
            TEST_MIGRATIONS: migrations,
          },
          compatibilityDate: "2026-07-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          serviceBindings: {
            ASSETS: () => new Response("test asset", { status: 200 }),
          },
        },
      };
    }),
  ],
  test: {
    include: ["src/**/*.workers.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
