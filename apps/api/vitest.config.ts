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
            R2_TRANSFER_ENABLED: "true",
            R2_ACCOUNT_ID: "00000000000000000000000000000000",
            R2_BUCKET_NAME: "change-me-private-audio",
            R2_S3_ACCESS_KEY_ID: "test-access-key-0001",
            R2_S3_SECRET_ACCESS_KEY: "test-secret-access-key-000000000001",
            MAX_UPLOAD_BYTES: "524288000",
            MAX_ACTIVE_UPLOADS_PER_OWNER: "3",
            UPLOAD_URL_TTL_SECONDS: "60",
            DOWNLOAD_URL_TTL_SECONDS: "60",
            TEST_MIGRATIONS: migrations,
          },
          compatibilityDate: "2026-07-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          r2Buckets: ["AUDIO_BUCKET"],
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
