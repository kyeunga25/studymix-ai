import { describe, expect, it } from "vitest";
import {
  buildWranglerEnvironment,
  buildDeploymentReport,
  selectActiveVersionId,
  summarizeMigrations,
} from "./verify-cloudflare-deployment.mjs";

const deploymentFixture = [
  {
    created_on: "2026-07-26T00:00:00.000Z",
    versions: [{ percentage: 100, version_id: "private-version-id" }],
  },
];

const configuredBindings = [
  { type: "assets", name: "ASSETS" },
  { type: "d1", name: "DB", database_id: "private-database-id" },
  { type: "r2_bucket", name: "AUDIO_BUCKET", bucket_name: "private-bucket-name" },
  { type: "workflow", name: "GENERATION_WORKFLOW", workflow_name: "private-workflow-name" },
  { type: "ratelimit", name: "JOB_RATE_LIMITER", namespace_id: "private-namespace" },
  { type: "plain_text", name: "APP_ENV", text: "production" },
  {
    type: "plain_text",
    name: "ACCESS_TEAM_DOMAIN",
    text: "https://private-team.cloudflareaccess.com",
  },
  {
    type: "plain_text",
    name: "ACCESS_AUD",
    text: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
  },
  {
    type: "plain_text",
    name: "LEGAL_CONTACT_EMAIL",
    text: ["privacy", "deployment-fixture.dev"].join("@"),
  },
  { type: "plain_text", name: "GENERATION_PROVIDER", text: "fal" },
  { type: "plain_text", name: "R2_TRANSFER_ENABLED", text: "true" },
  { type: "plain_text", name: "JOB_WORKFLOW_ENABLED", text: "true" },
  { type: "plain_text", name: "RETENTION_CLEANUP_ENABLED", text: "true" },
  { type: "plain_text", name: "REAL_GENERATION_ENABLED", text: "true" },
];

const configuredSecrets = [
  { name: "R2_S3_ACCESS_KEY_ID" },
  { name: "R2_S3_SECRET_ACCESS_KEY" },
  { name: "FAL_KEY" },
  { name: "FAL_WEBHOOK_USER_ID" },
  { name: "TURNSTILE_SECRET_KEY" },
];

const passingLiveStatus = {
  checked: true,
  reachable: true,
  publicOverview: true,
  health: true,
  legalManifest: true,
  privateAppProtected: true,
  privateApiProtected: true,
};

describe("privacy-safe Cloudflare deployment verification", () => {
  it("keeps Wrangler JSON output enabled while discarding its log file", () => {
    expect(
      buildWranglerEnvironment({
        WRANGLER_LOG: "error",
        WRANGLER_LOG_PATH: "private-log-path",
        EXISTING_SETTING: "preserved",
      }),
    ).toEqual({
      EXISTING_SETTING: "preserved",
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_WRITE_LOGS: "false",
    });
  });

  it("reports readiness without returning external identifiers or configuration values", () => {
    const report = buildDeploymentReport({
      deployments: deploymentFixture,
      version: { resources: { bindings: configuredBindings } },
      secrets: configuredSecrets,
      migrations: { checked: true, current: true, pendingCount: 0 },
      expectedEnvironment: "production",
      live: passingLiveStatus,
    });

    expect(report.readiness).toEqual({
      publicSurface: true,
      privateMock: true,
      realProvider: true,
    });
    const serialized = JSON.stringify(report);
    for (const sensitiveValue of [
      "private-version-id",
      "private-database-id",
      "private-bucket-name",
      "private-workflow-name",
      "private-namespace",
      "private-team",
      ["privacy", "deployment-fixture.dev"].join("@"),
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  });

  it("fails every readiness tier when placeholders and optional bindings remain", () => {
    const report = buildDeploymentReport({
      deployments: deploymentFixture,
      version: {
        resources: {
          bindings: [
            { type: "assets", name: "ASSETS" },
            { type: "d1", name: "DB", database_id: "private-database-id" },
            { type: "plain_text", name: "APP_ENV", text: "production" },
            {
              type: "plain_text",
              name: "ACCESS_TEAM_DOMAIN",
              text: "https://CHANGE-ME.cloudflareaccess.com",
            },
            { type: "plain_text", name: "ACCESS_AUD", text: "CHANGE_ME" },
            { type: "plain_text", name: "LEGAL_CONTACT_EMAIL", text: "CHANGE_ME" },
            { type: "plain_text", name: "GENERATION_PROVIDER", text: "mock" },
            { type: "plain_text", name: "REAL_GENERATION_ENABLED", text: "false" },
          ],
        },
      },
      secrets: [],
      migrations: { checked: true, current: true, pendingCount: 0 },
      expectedEnvironment: "production",
      live: {
        ...passingLiveStatus,
        reachable: false,
        publicOverview: false,
        health: false,
        legalManifest: false,
      },
    });

    expect(report.runtime.accessConfigured).toBe(false);
    expect(report.runtime.legalContactConfigured).toBe(false);
    expect(report.readiness).toEqual({
      publicSurface: false,
      privateMock: false,
      realProvider: false,
    });
  });

  it("counts unique pending migrations without returning their names", () => {
    const migrations = summarizeMigrations(
      "0003_jobs_owner_created_index.sql\n0003_jobs_owner_created_index.sql\n0004_safe.sql\n",
    );

    expect(migrations).toEqual({ checked: true, current: false, pendingCount: 2 });
    expect(JSON.stringify(migrations)).not.toContain("jobs_owner_created");
  });

  it("recognizes a current remote migration state", () => {
    expect(summarizeMigrations("No migrations to apply!")).toEqual({
      checked: true,
      current: true,
      pendingCount: 0,
    });
  });

  it("selects the fully active version from the newest deployment", () => {
    expect(
      selectActiveVersionId([
        {
          created_on: "2026-07-25T00:00:00.000Z",
          versions: [{ percentage: 100, version_id: "older" }],
        },
        {
          created_on: "2026-07-26T00:00:00.000Z",
          versions: [
            { percentage: 10, version_id: "canary" },
            { percentage: 90, version_id: "newest-active" },
          ],
        },
      ]),
    ).toBe("newest-active");
  });
});
