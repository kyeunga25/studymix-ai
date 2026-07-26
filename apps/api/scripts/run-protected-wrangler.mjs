import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { resolveProtectedConfigPath } from "./create-cloudflare-config.mjs";

const actions = {
  deploy: ["deploy"],
  preview: ["versions", "upload"],
};

export function buildProtectedWranglerArgs(action, configPath) {
  const command = actions[action];
  if (command === undefined) {
    throw new Error("Expected deploy or preview action.");
  }
  return [...command, "--config", configPath];
}

export function buildProtectedWranglerEnvironment(environment) {
  const result = {
    ...environment,
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_WRITE_LOGS: "false",
  };
  delete result.WRANGLER_LOG;
  delete result.WRANGLER_LOG_PATH;
  return result;
}

function main() {
  const configPath = resolveProtectedConfigPath(process.env.DEPLOY_CONFIG_PATH);
  const result = spawnSync("wrangler", buildProtectedWranglerArgs(process.argv[2], configPath), {
    cwd: process.cwd(),
    env: buildProtectedWranglerEnvironment(process.env),
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main();
}
