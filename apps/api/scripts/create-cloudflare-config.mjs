import { writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function requiredEnvironment(environment, name, pattern) {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0 || !pattern.test(value)) {
    throw new Error(`Missing or invalid protected build setting: ${name}`);
  }
  return value;
}

function optionalEnvironment(environment, name, pattern) {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!pattern.test(value)) {
    throw new Error(`Invalid protected build setting: ${name}`);
  }
  return value;
}

export function resolveProtectedConfigPath(rawPath, workingDirectory = process.cwd()) {
  const candidate = rawPath?.trim() || "wrangler.deploy.json";
  const absolutePath = resolve(workingDirectory, candidate);
  const relativePath = relative(workingDirectory, absolutePath);
  if (
    relativePath === "" ||
    isAbsolute(relativePath) ||
    relativePath.startsWith("..") ||
    !/^wrangler\.[a-z0-9-]+\.json$/.test(relativePath)
  ) {
    throw new Error("Invalid protected build setting: DEPLOY_CONFIG_PATH");
  }
  return absolutePath;
}

export function buildProtectedCloudflareConfig(environment) {
  const workerName = requiredEnvironment(
    environment,
    "DEPLOY_WORKER_NAME",
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );
  const databaseName = requiredEnvironment(
    environment,
    "DEPLOY_D1_NAME",
    /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/,
  );
  const databaseId = requiredEnvironment(
    environment,
    "DEPLOY_D1_ID",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const r2BucketName = optionalEnvironment(
    environment,
    "DEPLOY_R2_BUCKET",
    /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/,
  );
  const workflowName = optionalEnvironment(
    environment,
    "DEPLOY_WORKFLOW_NAME",
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );
  const rateLimitNamespaceId = optionalEnvironment(
    environment,
    "DEPLOY_RATE_LIMIT_NAMESPACE_ID",
    /^[1-9][0-9]{0,15}$/,
  );

  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: workerName,
    main: "src/index.ts",
    compatibility_date: "2026-07-24",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    keep_vars: true,
    assets: {
      directory: "../web/dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: true,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: databaseName,
        database_id: databaseId,
        migrations_dir: "migrations",
      },
    ],
    ...(r2BucketName === undefined
      ? {}
      : {
          r2_buckets: [
            {
              binding: "AUDIO_BUCKET",
              bucket_name: r2BucketName,
            },
          ],
          triggers: {
            crons: ["17 * * * *"],
          },
        }),
    ...(workflowName === undefined
      ? {}
      : {
          workflows: [
            {
              binding: "GENERATION_WORKFLOW",
              name: workflowName,
              class_name: "GenerationWorkflow",
            },
          ],
        }),
    ...(rateLimitNamespaceId === undefined
      ? {}
      : {
          ratelimits: [
            {
              name: "JOB_RATE_LIMITER",
              namespace_id: rateLimitNamespaceId,
              simple: { limit: 6, period: 60 },
            },
          ],
        }),
    observability: {
      enabled: true,
    },
  };
}

export function prepareProtectedCloudflareConfig(
  environment = process.env,
  workingDirectory = process.cwd(),
) {
  const outputPath = resolveProtectedConfigPath(environment.DEPLOY_CONFIG_PATH, workingDirectory);
  const config = buildProtectedCloudflareConfig(environment);
  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

function main() {
  prepareProtectedCloudflareConfig();
  process.stdout.write("Protected Cloudflare deployment configuration prepared.\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main();
}
