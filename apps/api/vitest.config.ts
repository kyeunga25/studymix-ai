import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      const localAiMigrations = await readD1Migrations(
        path.join(import.meta.dirname, "test", "local-ai-migrations"),
      );
      return {
        main: path.join(import.meta.dirname, "src/index.ts"),
        miniflare: {
          bindings: {
            ACCESS_AUD: "",
            ACCESS_TEAM_DOMAIN: "",
            APP_ENV: "test",
            DEV_AUTH_SUBJECT: "studymix-integration-tests",
            OWNER_IDENTITY_PEPPER:
              "pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp",
            LEGAL_CONTACT_EMAIL: "privacy@example.test",
            GENERATION_PROVIDER: "mock",
            REAL_GENERATION_ENABLED: "false",
            CREDIT_ACCOUNTING_ENABLED: "true",
            CREDITS_PER_JOB: "2",
            FAL_KEY: "CHANGE_ME_FAL_KEY_000000",
            FAL_WEBHOOK_URL: "https://studymix.example/api/webhooks/fal",
            FAL_WEBHOOK_USER_ID: "test-fal-user",
            FAL_OUTPUT_EXPIRATION_SECONDS: "3600",
            FAL_QUEUE_START_TIMEOUT_SECONDS: "300",
            FAL_POLL_INTERVAL_SECONDS: "10",
            FAL_MAX_POLL_ATTEMPTS: "120",
            MAX_PROVIDER_OUTPUT_BYTES: "104857600",
            PROVIDER_OUTPUT_TIMEOUT_SECONDS: "120",
            JOB_WORKFLOW_ENABLED: "true",
            R2_TRANSFER_ENABLED: "true",
            RETENTION_CLEANUP_ENABLED: "true",
            R2_ACCOUNT_ID: "00000000000000000000000000000000",
            R2_BUCKET_NAME: "change-me-private-audio",
            R2_S3_ACCESS_KEY_ID: "test-access-key-0001",
            R2_S3_SECRET_ACCESS_KEY: "test-secret-access-key-000000000001",
            MAX_UPLOAD_BYTES: "524288000",
            MAX_ACTIVE_UPLOADS_PER_OWNER: "3",
            MAX_ACTIVE_JOBS_PER_OWNER: "2",
            MAX_DAILY_JOBS_PER_OWNER: "4",
            ABANDONED_UPLOAD_RETENTION_HOURS: "24",
            SOURCE_RETENTION_HOURS: "72",
            FAILED_ARTIFACT_RETENTION_HOURS: "24",
            OUTPUT_RETENTION_HOURS: "168",
            RETENTION_CLEANUP_BATCH_SIZE: "50",
            UPLOAD_URL_TTL_SECONDS: "60",
            DOWNLOAD_URL_TTL_SECONDS: "60",
            TEST_MIGRATIONS: [...migrations, ...localAiMigrations],
          },
          compatibilityDate: "2026-07-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          r2Buckets: ["AUDIO_BUCKET"],
          ratelimits: {
            JOB_RATE_LIMITER: {
              namespace_id: "1001",
              simple: { limit: 100, period: 60 },
            },
          },
          workflows: {
            GENERATION_WORKFLOW: {
              className: "GenerationWorkflow",
              name: "change-me-generation-workflow",
            },
          },
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
