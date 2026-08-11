import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findTrackedConfigCandidates,
  formatPublicConfigIssues,
  parseJsonc,
  parsePublicEnvExample,
  parseTrackedPublicJsonc,
  validatePublicEnvironmentExample,
  validatePublicWranglerConfig,
} from "./validate-public-config.mjs";

function canonicalFixture() {
  return {
    name: "studymix-ai",
    send_metrics: false,
    dependencies_instrumentation: { enabled: false },
    d1_databases: [
      {
        database_name: "CHANGE_ME_DATABASE_NAME",
        database_id: "00000000-0000-0000-0000-000000000000",
      },
    ],
    r2_buckets: [{ bucket_name: "CHANGE_ME_BUCKET_NAME" }],
    workflows: [{ name: "CHANGE_ME_WORKFLOW_NAME" }],
    ratelimits: [{ namespace_id: "1001" }],
    vars: {
      ACCESS_TEAM_DOMAIN: "owner.example.test",
      ACCESS_AUD: "CHANGE_ME_ACCESS_AUD",
      DEV_AUTH_SUBJECT: "local-development-owner",
      OWNER_IDENTITY_PEPPER: "",
      LEGAL_CONTACT_EMAIL: "privacy@example.test",
      GENERATION_PROVIDER: "mock",
      CREDIT_ACCOUNTING_ENABLED: "false",
      JOB_WORKFLOW_ENABLED: "false",
      R2_TRANSFER_ENABLED: "false",
      REAL_GENERATION_ENABLED: "false",
      RETENTION_CLEANUP_ENABLED: "false",
      FAL_KEY: "CHANGE_ME_FAL_KEY",
      FAL_WEBHOOK_URL: "https://provider.example.test/webhook",
      R2_ACCOUNT_ID: "00000000000000000000000000000000",
      R2_S3_ACCESS_KEY_ID: "",
      R2_S3_SECRET_ACCESS_KEY: "",
    },
  };
}

describe("tracked public Cloudflare configuration", () => {
  it("accepts the canonical checked-in JSONC without exposing its values", async () => {
    const source = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(
      validatePublicWranglerConfig(parseTrackedPublicJsonc(source), {
        requireCanonicalShape: true,
      }),
    ).toEqual([]);
  });

  it("accepts only explicit placeholder semantics for protected fields", () => {
    expect(
      validatePublicWranglerConfig(canonicalFixture(), { requireCanonicalShape: true }),
    ).toEqual([]);
  });

  it("fails concrete protected values without including those values in diagnostics", () => {
    const config = canonicalFixture();
    const concreteCredential = "concrete-credential-material";
    const concreteResourceId = "123e4567-e89b-42d3-a456-426614174000";
    const concreteDomain = "https://private-team.cloudflareaccess.com";
    const concreteOrigin = "https://private-api.company.local";
    const concreteWorkflow = "production-generation-workflow";
    config.vars.FAL_KEY = concreteCredential;
    config.vars.ACCESS_TEAM_DOMAIN = concreteDomain;
    config.vars.PRIVATE_API_ORIGIN = concreteOrigin;
    config.d1_databases[0].database_id = concreteResourceId;
    config.workflows[0].name = concreteWorkflow;

    const issues = validatePublicWranglerConfig(config, { requireCanonicalShape: true });
    const messages = formatPublicConfigIssues("apps/api/wrangler.jsonc", issues).join("\n");
    expect(messages).toContain("vars.FAL_KEY");
    expect(messages).toContain("vars.ACCESS_TEAM_DOMAIN");
    expect(messages).toContain("vars.PRIVATE_API_ORIGIN");
    expect(messages).toContain("d1_databases[0].database_id");
    expect(messages).toContain("workflows[0].name");
    expect(messages).not.toContain(concreteCredential);
    expect(messages).not.toContain(concreteDomain);
    expect(messages).not.toContain(concreteOrigin);
    expect(messages).not.toContain(concreteResourceId);
    expect(messages).not.toContain(concreteWorkflow);
  });

  it("rejects a concrete Worker name in any additional tracked config candidate", () => {
    expect(
      validatePublicWranglerConfig({
        name: "private-production-worker",
        send_metrics: false,
        dependencies_instrumentation: { enabled: false },
      }),
    ).toEqual([expect.objectContaining({ keyPath: "name" })]);
  });

  it("requires every tracked Wrangler config to disable optional data sharing", () => {
    const enabledConfig = canonicalFixture();
    enabledConfig.send_metrics = true;
    enabledConfig.dependencies_instrumentation.enabled = true;

    expect(validatePublicWranglerConfig(enabledConfig)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyPath: "send_metrics" }),
        expect.objectContaining({ keyPath: "dependencies_instrumentation.enabled" }),
      ]),
    );
    expect(validatePublicWranglerConfig({ name: "placeholder-worker" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyPath: "send_metrics" }),
        expect.objectContaining({ keyPath: "dependencies_instrumentation.enabled" }),
      ]),
    );
  });

  it("fails closed when public capability switches become deployable", () => {
    const config = canonicalFixture();
    config.vars.REAL_GENERATION_ENABLED = "true";
    config.vars.GENERATION_PROVIDER = "external";

    expect(validatePublicWranglerConfig(config, { requireCanonicalShape: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyPath: "vars.REAL_GENERATION_ENABLED" }),
        expect.objectContaining({ keyPath: "vars.GENERATION_PROVIDER" }),
      ]),
    );
  });

  it("fails closed in additional configs and named Wrangler environment overrides", () => {
    const config = {
      name: "placeholder-worker",
      send_metrics: false,
      dependencies_instrumentation: { enabled: false },
      vars: {
        GENERATION_PROVIDER: "external",
        R2_TRANSFER_ENABLED: "true",
      },
      env: {
        preview: {
          vars: {
            GENERATION_PROVIDER: "fal",
            REAL_GENERATION_ENABLED: "true",
          },
        },
      },
    };

    expect(validatePublicWranglerConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyPath: "vars.GENERATION_PROVIDER" }),
        expect.objectContaining({ keyPath: "vars.R2_TRANSFER_ENABLED" }),
        expect.objectContaining({ keyPath: "env.preview.vars.GENERATION_PROVIDER" }),
        expect.objectContaining({ keyPath: "env.preview.vars.REAL_GENERATION_ENABLED" }),
      ]),
    );
  });

  it("rejects unapproved Wrangler variable aliases without reporting their values", () => {
    const hiddenContent = "concrete-hidden-configuration";
    const config = canonicalFixture();
    config.vars.UNRECOGNIZED_NOTE = hiddenContent;
    config.env = {
      preview: {
        vars: { UNRECOGNIZED_NOTE: hiddenContent },
      },
    };

    const issues = validatePublicWranglerConfig(config, { requireCanonicalShape: true });
    const messages = formatPublicConfigIssues("apps/api/wrangler.jsonc", issues).join("\n");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyPath: "vars.UNRECOGNIZED_NOTE" }),
        expect.objectContaining({ keyPath: "env.preview.vars.UNRECOGNIZED_NOTE" }),
      ]),
    );
    expect(messages).not.toContain(hiddenContent);
  });

  it("rejects credentials and signed-query material hidden in placeholder locations", () => {
    const config = canonicalFixture();
    const sensitiveQueryMaterial = "sensitive-query-material";
    const sensitivePassword = "sensitive-password";
    config.vars.FAL_WEBHOOK_URL = `https://webhook.example.test/callback?token=${sensitiveQueryMaterial}`;
    config.vars.ACCESS_TEAM_DOMAIN = `https://owner:${sensitivePassword}@CHANGE-ME.cloudflareaccess.com`;
    config.vars.FAL_KEY = `CHANGE_ME_FAL_KEY?${sensitiveQueryMaterial}`;
    config.vars.PRIVATE_API_ORIGIN = "https://api.example.test/private-path";

    const issues = validatePublicWranglerConfig(config, { requireCanonicalShape: true });
    const messages = formatPublicConfigIssues("apps/api/wrangler.jsonc", issues).join("\n");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyPath: "vars.FAL_WEBHOOK_URL" }),
        expect.objectContaining({ keyPath: "vars.ACCESS_TEAM_DOMAIN" }),
        expect.objectContaining({ keyPath: "vars.FAL_KEY" }),
        expect.objectContaining({ keyPath: "vars.PRIVATE_API_ORIGIN" }),
      ]),
    );
    expect(messages).not.toContain(sensitiveQueryMaterial);
    expect(messages).not.toContain(sensitivePassword);
  });

  it("parses comments and trailing commas while redacting invalid JSONC errors", () => {
    expect(parseJsonc('{ // comment\n "name": "example",\n}')).toEqual({ name: "example" });
    expect(() => parseJsonc('{ "credential": "do-not-report" ')).toThrow("invalid JSONC syntax");
  });

  it("rejects comments in tracked Wrangler JSONC without echoing hidden content", () => {
    const hiddenContent = "concrete-hidden-configuration";
    const source = `{ "url": "https://example.test/literal/*value*/" } // ${hiddenContent}`;

    expect(parseTrackedPublicJsonc('{ "url": "https://example.test/literal/*value*/" }')).toEqual({
      url: "https://example.test/literal/*value*/",
    });
    try {
      parseTrackedPublicJsonc(source);
      throw new Error("Expected tracked comments to be rejected.");
    } catch (error) {
      expect(String(error)).toContain("comments are forbidden");
      expect(String(error)).not.toContain(hiddenContent);
    }
    expect(() => parseTrackedPublicJsonc('{ /* hidden */ "name": "example" }')).toThrow(
      "comments are forbidden",
    );
  });

  it("rejects duplicate decoded JSON keys before a placeholder can hide a concrete value", () => {
    const concreteCredential = "concrete-credential-material";
    const source = `{
      "vars": {
        "FAL_KEY": "${concreteCredential}",
        "FAL_\\u004bEY": "CHANGE_ME_FAL_KEY"
      },
      "first": { "name": "example" },
      "second": { "name": "example" }
    }`;

    expect(() => parseJsonc(source)).toThrow("invalid JSONC syntax");
    try {
      parseJsonc(source);
    } catch (error) {
      expect(String(error)).not.toContain(concreteCredential);
    }
    expect(
      parseJsonc('{ "first": { "name": "example" }, "second": { "name": "example" } }'),
    ).toEqual({ first: { name: "example" }, second: { name: "example" } });
  });

  it("covers tracked JSON and JSONC candidates without reading ignored files", () => {
    expect(
      findTrackedConfigCandidates([
        ".env.example",
        ".env.production",
        "apps/api/wrangler.jsonc",
        "apps/api/wrangler.preview.jsonc",
        "apps/api/wrangler.production.json",
        "apps/api/config.json",
      ]),
    ).toEqual({
      forbiddenPrivatePaths: [".env.production"],
      publicConfigPaths: [
        "apps/api/wrangler.jsonc",
        "apps/api/wrangler.preview.jsonc",
        "apps/api/wrangler.production.json",
      ],
      publicEnvPaths: [".env.example"],
    });
  });

  it("validates tracked public environment examples semantically without reporting values", () => {
    const concreteOrigin = "https://private-api.company.local";
    const parsed = parsePublicEnvExample(
      [
        "GENERATION_PROVIDER=mock",
        "REAL_GENERATION_ENABLED=false",
        "FAL_KEY=",
        `PRIVATE_API_ORIGIN=${concreteOrigin}`,
      ].join("\n"),
    );
    const messages = formatPublicConfigIssues(
      ".env.example",
      validatePublicEnvironmentExample(parsed.values),
    ).join("\n");

    expect(parsed.issues).toEqual([]);
    expect(messages).toContain("PRIVATE_API_ORIGIN");
    expect(messages).not.toContain(concreteOrigin);
  });

  it("rejects duplicate public environment keys without reporting either value", () => {
    const concreteCredential = "concrete-credential-material";
    const parsed = parsePublicEnvExample(
      [`FAL_KEY=${concreteCredential}`, "FAL_KEY=CHANGE_ME_FAL_KEY"].join("\n"),
    );
    const messages = formatPublicConfigIssues(".env.example", [
      ...parsed.issues,
      ...validatePublicEnvironmentExample(parsed.values),
    ]).join("\n");

    expect(parsed.issues).toEqual([
      expect.objectContaining({ keyPath: "line[2]", reason: expect.stringContaining("repeat") }),
    ]);
    expect(messages).toContain("FAL_KEY");
    expect(messages).not.toContain(concreteCredential);
    expect(messages).not.toContain("CHANGE_ME_FAL_KEY");
  });

  it("accepts only approved public environment comments without echoing hidden content", () => {
    const hiddenContent = "concrete-hidden-configuration";
    const parsed = parsePublicEnvExample(
      [
        "# Public web configuration",
        "VITE_API_BASE_URL=http://localhost:8787",
        `# ${hiddenContent}`,
        `APP_ENV=local # ${hiddenContent}`,
      ].join("\n"),
    );
    const messages = formatPublicConfigIssues(".env.example", parsed.issues).join("\n");

    expect(parsed.values).toEqual({ VITE_API_BASE_URL: "http://localhost:8787" });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ keyPath: "line[3]", reason: expect.stringContaining("approved") }),
      expect.objectContaining({ keyPath: "line[4]", reason: expect.stringContaining("inline") }),
    ]);
    expect(messages).not.toContain(hiddenContent);
  });

  it("rejects unapproved public environment variable aliases without reporting values", () => {
    const hiddenContent = "concrete-hidden-configuration";
    const environment = parsePublicEnvExample(`UNRECOGNIZED_NOTE=${hiddenContent}`).values;
    const issues = validatePublicEnvironmentExample(environment);
    const messages = formatPublicConfigIssues(".env.example", issues).join("\n");

    expect(issues).toEqual([
      expect.objectContaining({
        keyPath: "UNRECOGNIZED_NOTE",
        reason: expect.stringContaining("approved"),
      }),
    ]);
    expect(messages).not.toContain(hiddenContent);
  });
});
