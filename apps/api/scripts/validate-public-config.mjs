import { spawnSync } from "node:child_process";
import console from "node:console";
import { lstat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { CLOUDFLARE_WORKER_NAME } from "./cloudflare-deployment.mjs";

export const CANONICAL_PUBLIC_CONFIG_PATH = "apps/api/wrangler.jsonc";

const SYNTHETIC_RATE_LIMIT_NAMESPACE = "1001";
const WRANGLER_CONFIG_PATTERN = /(^|\/)wrangler(?:\.[^/]+)?\.jsonc?$/;
const PRIVATE_ENV_PATTERN = /(^|\/)(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?)$/;
const EXPLICIT_PLACEHOLDER_PATTERN = /^(?:change[-_ ]?me)(?:[-_ ][a-z0-9][a-z0-9._ -]*)?$/i;
const SYNTHETIC_LABEL_PATTERN =
  /^(?:(?:example|placeholder|synthetic)(?:[-_.][a-z0-9]+)*|local-(?:development|test)(?:[-_.][a-z0-9]+)*)$/i;
const ALL_ZERO_ID_PATTERN = /^(?:0{8,}|0{8}-0{4}-0{4}-0{4}-0{12})$/;
const FAIL_CLOSED_FLAGS = [
  "CREDIT_ACCOUNTING_ENABLED",
  "JOB_WORKFLOW_ENABLED",
  "R2_TRANSFER_ENABLED",
  "REAL_GENERATION_ENABLED",
  "RETENTION_CLEANUP_ENABLED",
];
const ALLOWED_PUBLIC_ENV_COMMENTS = new Set([
  "# Public web configuration",
  "# Non-secret Worker configuration",
  "# Secret names are documented only. Set real values with Wrangler secrets or .dev.vars.",
]);
const APPROVED_PUBLIC_WRANGLER_VAR_KEYS = new Set([
  "ABANDONED_UPLOAD_RETENTION_HOURS",
  "ACCESS_AUD",
  "ACCESS_TEAM_DOMAIN",
  "APP_ENV",
  "CREDITS_PER_JOB",
  "CREDIT_ACCOUNTING_ENABLED",
  "DEV_AUTH_SUBJECT",
  "DOWNLOAD_URL_TTL_SECONDS",
  "FAILED_ARTIFACT_RETENTION_HOURS",
  "FAL_KEY",
  "FAL_MAX_POLL_ATTEMPTS",
  "FAL_OUTPUT_EXPIRATION_SECONDS",
  "FAL_POLL_INTERVAL_SECONDS",
  "FAL_QUEUE_START_TIMEOUT_SECONDS",
  "FAL_WEBHOOK_URL",
  "FAL_WEBHOOK_USER_ID",
  "GENERATION_PROVIDER",
  "JOB_WORKFLOW_ENABLED",
  "LEGAL_CONTACT_EMAIL",
  "MAX_ACTIVE_JOBS_PER_OWNER",
  "MAX_ACTIVE_UPLOADS_PER_OWNER",
  "MAX_DAILY_JOBS_PER_OWNER",
  "MAX_PROVIDER_OUTPUT_BYTES",
  "MAX_UPLOAD_BYTES",
  "OUTPUT_RETENTION_HOURS",
  "OWNER_IDENTITY_PEPPER",
  "PROVIDER_OUTPUT_TIMEOUT_SECONDS",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_S3_ACCESS_KEY_ID",
  "R2_S3_SECRET_ACCESS_KEY",
  "R2_TRANSFER_ENABLED",
  "REAL_GENERATION_ENABLED",
  "RETENTION_CLEANUP_BATCH_SIZE",
  "RETENTION_CLEANUP_ENABLED",
  "SOURCE_RETENTION_HOURS",
  "UPLOAD_URL_TTL_SECONDS",
]);
const APPROVED_PUBLIC_ENV_EXAMPLE_KEYS = new Set([
  ...APPROVED_PUBLIC_WRANGLER_VAR_KEYS,
  "ALLOWED_WEB_ORIGINS",
  "TURNSTILE_SECRET_KEY",
  "VITE_API_BASE_URL",
]);

function redactLabel(value) {
  return String(value).replace(/[^\x20-\x7e]/g, "?");
}

function stripJsonComments(source) {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        result += current;
      } else {
        result += " ";
      }
      continue;
    }

    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += current === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
    } else if (current === "/" && next === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
    } else {
      result += current;
    }
  }

  return result;
}

function hasJsonComment(source) {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      continue;
    }
    if (current === "/" && (next === "/" || next === "*")) return true;
  }

  return false;
}

function stripTrailingCommas(source) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
      continue;
    }

    if (current === ",") {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") {
        result += " ";
        continue;
      }
    }

    result += current;
  }

  return result;
}

function hasDuplicateJsonObjectKey(source) {
  const containers = [];

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (current === "{") {
      containers.push(new Set());
      continue;
    }
    if (current === "[") {
      containers.push(null);
      continue;
    }
    if (current === "}" || current === "]") {
      containers.pop();
      continue;
    }
    if (current !== '"') continue;

    const stringStart = index;
    let escaped = false;
    for (index += 1; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        break;
      }
    }

    let lookahead = index + 1;
    while (/\s/.test(source[lookahead] ?? "")) lookahead += 1;
    const currentObjectKeys = containers.at(-1);
    if (source[lookahead] !== ":" || !(currentObjectKeys instanceof Set)) continue;

    const key = JSON.parse(source.slice(stringStart, index + 1));
    if (currentObjectKeys.has(key)) return true;
    currentObjectKeys.add(key);
  }

  return false;
}

export function parseJsonc(source) {
  try {
    const normalized = stripTrailingCommas(stripJsonComments(source));
    const parsed = JSON.parse(normalized);
    if (hasDuplicateJsonObjectKey(normalized)) throw new TypeError("duplicate JSON object key");
    return parsed;
  } catch {
    throw new Error("invalid JSONC syntax");
  }
}

export function parseTrackedPublicJsonc(source) {
  if (hasJsonComment(source)) {
    throw new Error("comments are forbidden in tracked public JSONC");
  }
  return parseJsonc(source);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExplicitPlaceholder(value) {
  return typeof value === "string" && EXPLICIT_PLACEHOLDER_PATTERN.test(value);
}

function isAllZeroId(value) {
  return typeof value === "string" && ALL_ZERO_ID_PATTERN.test(value);
}

function isSyntheticLabel(value) {
  return typeof value === "string" && SYNTHETIC_LABEL_PATTERN.test(value);
}

function extractHostname(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    const atIndex = value.lastIndexOf("@");
    return (atIndex >= 0 ? value.slice(atIndex + 1) : value).toLowerCase();
  }
}

function isReservedDomain(value) {
  const hostname = extractHostname(value);
  if (!hostname) return false;
  return (
    hostname === "example.com" ||
    hostname === "example.net" ||
    hostname === "example.org" ||
    hostname === "localhost" ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".test")
  );
}

function hasPlaceholderDomainLabel(value) {
  const hostname = extractHostname(value);
  return (
    typeof hostname === "string" &&
    hostname.split(".").some((label) => /^change[-_]?me(?:[-_].*)?$/i.test(label))
  );
}

function hasDisallowedAddressCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "?" || character === "#" || codePoint <= 31 || codePoint === 127;
  });
}

function hasSafePlaceholderAddressSyntax(value, keyPath) {
  if (typeof value !== "string" || hasDisallowedAddressCharacter(value)) return false;

  let url;
  try {
    url = new URL(value);
  } catch {
    return true;
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return false;
  }

  const normalizedPath = keyPath.toLowerCase();
  if (normalizedPath.endsWith("origin") || normalizedPath.endsWith("origins")) {
    return url.pathname === "/";
  }
  return true;
}

function isSafeDomainPlaceholder(value, keyPath) {
  return (
    hasSafePlaceholderAddressSyntax(value, keyPath) &&
    (isReservedDomain(value) || hasPlaceholderDomainLabel(value))
  );
}

function isCredentialPath(keyPath) {
  return /(?:secret|token|password|pepper|api_key|access_key|fal_key)/i.test(keyPath);
}

function isEmptyProtectedSlotPath(keyPath) {
  return isCredentialPath(keyPath) || /(?:^|_)(?:aud|audience|subject|user_id)$/i.test(keyPath);
}

function isProtectedLeafPath(keyPath) {
  const normalized = keyPath.toLowerCase();
  return (
    /(?:^|\.)(?:[a-z0-9]+_)*(?:account_id|aud|audience|bucket_name|certificate_id|contact_email|database_id|database_name|hostname|index_name|namespace_id|preview_id|service|subject|team_domain|user_id|webhook_url|webhook_user_id|zone_id)$/.test(
      normalized,
    ) ||
    /(?:secret|token|password|pepper|api_key|access_key|fal_key)/.test(normalized) ||
    /^vars\.(?:[a-z0-9]+_)*(?:domain|email|id|origin|origins|url)$/.test(normalized) ||
    /^(?:route|routes)(?:\.|\[|$)/.test(normalized) ||
    /^(?:queues)(?:\.|\[).*(?:\.queue)$/.test(normalized) ||
    /^(?:analytics_engine_datasets|dispatch_namespaces|hyperdrive|kv_namespaces|mtls_certificates|vectorize)\[\d+\]\.(?:dataset|id|index_name|namespace|preview_id)$/.test(
      normalized,
    ) ||
    /^workflows\[\d+\]\.name$/.test(normalized)
  );
}

function isAllowedPlaceholder(value, keyPath) {
  if (isExplicitPlaceholder(value) || isAllZeroId(value) || isSyntheticLabel(value)) return true;
  if (
    keyPath.toLowerCase().endsWith("origins") &&
    typeof value === "string" &&
    value.split(",").every((origin) => isSafeDomainPlaceholder(origin.trim(), keyPath))
  ) {
    return true;
  }
  if (isSafeDomainPlaceholder(value, keyPath)) return true;
  if (isEmptyProtectedSlotPath(keyPath) && value === "") return true;
  return keyPath.endsWith("namespace_id") && value === SYNTHETIC_RATE_LIMIT_NAMESPACE;
}

function isVarsKeyPath(keyPath, key) {
  const suffix = `.vars.${key}`;
  return keyPath === `vars.${key}` || (keyPath.startsWith("env.") && keyPath.endsWith(suffix));
}

function collectLeafValues(value, keyPath = "", leaves = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectLeafValues(child, `${keyPath}[${index}]`, leaves));
    return leaves;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectLeafValues(child, keyPath ? `${keyPath}.${key}` : key, leaves);
    }
    return leaves;
  }

  leaves.push({ keyPath, value });
  return leaves;
}

function addIssue(issues, keyPath, reason) {
  issues.push({ keyPath, reason });
}

function validateCanonicalShape(config, issues) {
  if (config.name !== CLOUDFLARE_WORKER_NAME) {
    addIssue(issues, "name", "must remain the approved public Worker name");
  }

  const vars = isRecord(config.vars) ? config.vars : {};
  if (!("GENERATION_PROVIDER" in vars)) {
    addIssue(issues, "vars.GENERATION_PROVIDER", "must declare the credential-free mock provider");
  }
  for (const flag of FAIL_CLOSED_FLAGS) {
    if (!(flag in vars)) {
      addIssue(issues, `vars.${flag}`, "must be declared disabled in tracked public configuration");
    }
  }
}

function validateWranglerDataSharing(config, issues) {
  if (config.send_metrics !== false) {
    addIssue(issues, "send_metrics", "must disable optional Wrangler usage metrics");
  }

  if (
    !isRecord(config.dependencies_instrumentation) ||
    config.dependencies_instrumentation.enabled !== false
  ) {
    addIssue(
      issues,
      "dependencies_instrumentation.enabled",
      "must disable optional dependency metadata collection",
    );
  }
}

function validateWranglerVariableKeys(config, issues) {
  const scopes = [["vars", config.vars]];
  if (isRecord(config.env)) {
    for (const [environmentName, environmentConfig] of Object.entries(config.env)) {
      if (isRecord(environmentConfig)) {
        scopes.push([`env.${environmentName}.vars`, environmentConfig.vars]);
      }
    }
  }

  for (const [keyPath, vars] of scopes) {
    if (!isRecord(vars)) continue;
    for (const key of Object.keys(vars)) {
      if (!APPROVED_PUBLIC_WRANGLER_VAR_KEYS.has(key)) {
        addIssue(issues, `${keyPath}.${key}`, "must use an approved public variable name");
      }
    }
  }
}

export function validatePublicWranglerConfig(config, options = {}) {
  const issues = [];
  if (!isRecord(config)) {
    addIssue(issues, "$", "must contain a JSON object");
    return issues;
  }

  if (options.requireCanonicalShape === true) validateCanonicalShape(config, issues);
  validateWranglerDataSharing(config, issues);
  validateWranglerVariableKeys(config, issues);

  if (
    "name" in config &&
    config.name !== CLOUDFLARE_WORKER_NAME &&
    !isAllowedPlaceholder(config.name, "name")
  ) {
    addIssue(issues, "name", "must use the approved public name or a non-deployable placeholder");
  }

  for (const { keyPath, value } of collectLeafValues(config)) {
    if (isVarsKeyPath(keyPath, "GENERATION_PROVIDER") && value !== "mock") {
      addIssue(issues, keyPath, "must remain the credential-free mock provider");
    }
    for (const flag of FAIL_CLOSED_FLAGS) {
      if (isVarsKeyPath(keyPath, flag) && value !== "false") {
        addIssue(issues, keyPath, "must remain disabled in tracked public configuration");
      }
    }
    if (!isProtectedLeafPath(keyPath)) continue;
    if (!isAllowedPlaceholder(value, keyPath)) {
      addIssue(issues, keyPath, "must use an approved non-deployable placeholder");
    }
  }

  return issues;
}

export function parsePublicEnvExample(source) {
  const values = {};
  const issues = [];

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      if (!ALLOWED_PUBLIC_ENV_COMMENTS.has(line)) {
        addIssue(issues, `line[${index + 1}]`, "must use an approved public section comment");
      }
      continue;
    }
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      addIssue(issues, `line[${index + 1}]`, "must use KEY=value syntax");
      continue;
    }

    let value = match[2].trim();
    if (value.includes("#")) {
      addIssue(issues, `line[${index + 1}]`, "must not use inline comments");
      continue;
    }
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    const key = match[1];
    if (Object.hasOwn(values, key)) {
      addIssue(issues, `line[${index + 1}]`, "must not repeat an environment key");
      continue;
    }
    values[key] = value;
  }

  return { issues, values };
}

export function validatePublicEnvironmentExample(environment) {
  const issues = [];
  for (const [key, value] of Object.entries(environment)) {
    if (!APPROVED_PUBLIC_ENV_EXAMPLE_KEYS.has(key)) {
      addIssue(issues, key, "must use an approved public environment variable name");
      continue;
    }
    const keyPath = `vars.${key}`;
    if (!isProtectedLeafPath(keyPath)) continue;
    if (value !== "" && !isAllowedPlaceholder(value, keyPath)) {
      addIssue(issues, key, "must be empty or use an approved non-deployable placeholder");
    }
  }

  if ("GENERATION_PROVIDER" in environment && environment.GENERATION_PROVIDER !== "mock") {
    addIssue(issues, "GENERATION_PROVIDER", "must remain the credential-free mock provider");
  }
  for (const flag of FAIL_CLOSED_FLAGS) {
    if (flag in environment && environment[flag] !== "false") {
      addIssue(issues, flag, "must remain disabled in tracked public configuration");
    }
  }
  return issues;
}

export function findTrackedConfigCandidates(trackedFiles) {
  const publicConfigPaths = [];
  const publicEnvPaths = [];
  const forbiddenPrivatePaths = [];

  for (const path of trackedFiles) {
    if (WRANGLER_CONFIG_PATTERN.test(path)) publicConfigPaths.push(path);
    if (path.endsWith("/.env.example") || path === ".env.example") {
      publicEnvPaths.push(path);
      continue;
    }
    if (PRIVATE_ENV_PATTERN.test(path)) forbiddenPrivatePaths.push(path);
  }

  return {
    forbiddenPrivatePaths: forbiddenPrivatePaths.sort(),
    publicConfigPaths: publicConfigPaths.sort(),
    publicEnvPaths: publicEnvPaths.sort(),
  };
}

function listTrackedFiles(repoRoot) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) throw new Error("could not enumerate tracked files");
  return result.stdout.split("\0").filter(Boolean);
}

export function formatPublicConfigIssues(filePath, issues) {
  return issues.map(
    ({ keyPath, reason }) =>
      `${redactLabel(filePath)}: ${redactLabel(keyPath)}: ${redactLabel(reason)}`,
  );
}

async function readBoundedTrackedFile(repoRoot, path) {
  const root = resolve(repoRoot);
  const absolutePath = resolve(root, path);
  if (!absolutePath.startsWith(`${root}/`)) throw new Error("invalid tracked path");
  const stats = await lstat(absolutePath);
  if (!stats.isFile() || stats.size > 256 * 1024) throw new Error("invalid tracked file");
  return readFile(absolutePath, "utf8");
}

export async function validateTrackedPublicConfigs(repoRoot) {
  const trackedFiles = listTrackedFiles(repoRoot);
  const { forbiddenPrivatePaths, publicConfigPaths, publicEnvPaths } =
    findTrackedConfigCandidates(trackedFiles);
  const messages = [];

  for (const path of forbiddenPrivatePaths) {
    messages.push(`${redactLabel(path)}: tracked private environment file is forbidden`);
  }
  if (!publicConfigPaths.includes(CANONICAL_PUBLIC_CONFIG_PATH)) {
    messages.push(`${CANONICAL_PUBLIC_CONFIG_PATH}: canonical public configuration is missing`);
  }

  for (const path of publicConfigPaths) {
    let config;
    try {
      config = parseTrackedPublicJsonc(await readBoundedTrackedFile(repoRoot, path));
    } catch (error) {
      messages.push(
        error instanceof Error && error.message === "comments are forbidden in tracked public JSONC"
          ? `${redactLabel(path)}: $: comments are forbidden in tracked public configuration`
          : `${redactLabel(path)}: $: invalid JSONC syntax`,
      );
      continue;
    }

    messages.push(
      ...formatPublicConfigIssues(
        path,
        validatePublicWranglerConfig(config, {
          requireCanonicalShape: path === CANONICAL_PUBLIC_CONFIG_PATH,
        }),
      ),
    );
  }

  for (const path of publicEnvPaths) {
    try {
      const parsed = parsePublicEnvExample(await readBoundedTrackedFile(repoRoot, path));
      messages.push(...formatPublicConfigIssues(path, parsed.issues));
      messages.push(
        ...formatPublicConfigIssues(path, validatePublicEnvironmentExample(parsed.values)),
      );
    } catch {
      messages.push(`${redactLabel(path)}: $: invalid public environment example`);
    }
  }

  if (messages.length > 0) {
    throw new Error(["Public configuration validation failed:", ...messages].join("\n"));
  }

  return { checkedFiles: publicConfigPaths.length + publicEnvPaths.length };
}

const modulePath = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && resolve(process.argv[1]) === modulePath;

if (isMainModule) {
  const repoRoot = resolve(dirname(modulePath), "../../..");
  try {
    const result = await validateTrackedPublicConfigs(repoRoot);
    console.log(
      `Validated ${result.checkedFiles} tracked public Cloudflare configuration file(s).`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Public configuration validation failed.",
    );
    process.exitCode = 1;
  }
}
