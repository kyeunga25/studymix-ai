import { describe, expect, it } from "vitest";

import {
  buildProtectedCloudflareConfig,
  resolveProtectedConfigPath,
} from "./create-cloudflare-config.mjs";
import {
  buildProtectedWranglerArgs,
  buildProtectedWranglerEnvironment,
} from "./run-protected-wrangler.mjs";

const requiredSettings = {
  DEPLOY_D1_NAME: "private_database",
  DEPLOY_D1_ID: "123e4567-e89b-42d3-a456-426614174000",
};

describe("protected Cloudflare deployment configuration", () => {
  it("keeps an environment-specific config inside the current directory", () => {
    expect(resolveProtectedConfigPath(undefined, "/private/project")).toBe(
      "/private/project/wrangler.deploy.json",
    );
    expect(resolveProtectedConfigPath("wrangler.staging.json", "/private/project")).toBe(
      "/private/project/wrangler.staging.json",
    );
    expect(() =>
      resolveProtectedConfigPath("../wrangler.staging.json", "/private/project"),
    ).toThrow("DEPLOY_CONFIG_PATH");
    expect(() =>
      resolveProtectedConfigPath("nested/wrangler.staging.json", "/private/project"),
    ).toThrow("DEPLOY_CONFIG_PATH");
  });

  it("includes only explicitly configured optional Cloudflare bindings", () => {
    const minimalConfig = buildProtectedCloudflareConfig({
      ...requiredSettings,
      DEPLOY_WORKER_NAME: "studymix-ai-staging",
    });
    expect(minimalConfig.name).toBe("studymix-ai");
    expect(minimalConfig).not.toHaveProperty("r2_buckets");

    const config = buildProtectedCloudflareConfig({
      ...requiredSettings,
      DEPLOY_R2_BUCKET: "private-audio",
      DEPLOY_WORKFLOW_NAME: "private-workflow",
      DEPLOY_RATE_LIMIT_NAMESPACE_ID: "1001",
    });

    expect(config.r2_buckets?.[0]?.binding).toBe("AUDIO_BUCKET");
    expect(config.workflows?.[0]?.binding).toBe("GENERATION_WORKFLOW");
    expect(config.ratelimits?.[0]?.name).toBe("JOB_RATE_LIMITER");
    expect(config.keep_vars).toBe(true);
    expect(config.workers_dev).toBe(false);
    expect(config.send_metrics).toBe(false);
    expect(config.dependencies_instrumentation).toEqual({ enabled: false });
  });

  it("passes the same protected config to deploy and preview without local log files", () => {
    const configPath = "/private/project/wrangler.staging.json";
    expect(buildProtectedWranglerArgs("deploy", configPath)).toEqual([
      "deploy",
      "--config",
      configPath,
    ]);
    expect(buildProtectedWranglerArgs("preview", configPath)).toEqual([
      "versions",
      "upload",
      "--config",
      configPath,
    ]);
    expect(() => buildProtectedWranglerArgs("delete", configPath)).toThrow();

    const environment = buildProtectedWranglerEnvironment({
      WRANGLER_LOG: "error",
      WRANGLER_LOG_PATH: "private-log-path",
      WRANGLER_SEND_METRICS: "true",
      SAFE_VALUE: "kept",
    });
    expect(environment).toEqual({
      SAFE_VALUE: "kept",
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
    });
  });
});
