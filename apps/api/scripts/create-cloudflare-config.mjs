import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

function requiredEnvironment(name, pattern) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0 || !pattern.test(value)) {
    throw new Error(`Missing or invalid protected build setting: ${name}`);
  }
  return value;
}

function optionalEnvironment(name, pattern) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!pattern.test(value)) {
    throw new Error(`Invalid protected build setting: ${name}`);
  }
  return value;
}

const workerName = requiredEnvironment(
  "DEPLOY_WORKER_NAME",
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
);
const databaseName = requiredEnvironment(
  "DEPLOY_D1_NAME",
  /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/,
);
const databaseId = requiredEnvironment(
  "DEPLOY_D1_ID",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const r2BucketName = optionalEnvironment(
  "DEPLOY_R2_BUCKET",
  /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/,
);

const config = {
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
      }),
  observability: {
    enabled: true,
  },
};

const outputPath = resolve("wrangler.deploy.json");
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
process.stdout.write("Protected Cloudflare deployment configuration prepared.\n");
