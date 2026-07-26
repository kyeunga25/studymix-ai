import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { z } from "zod";

const workerNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reservedContactPattern =
  /(?:change[-_ ]?me|@(?:example(?:\.(?:com|net|org))?|localhost|[^@]+\.(?:invalid|localhost|test)))$/i;

const deploymentSchema = z
  .object({
    created_on: z.iso.datetime({ offset: true }),
    versions: z
      .array(
        z
          .object({
            percentage: z.number().min(0).max(100),
            version_id: z.string().min(1).max(256),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();

const deploymentsSchema = z.array(deploymentSchema).min(1);

const bindingSchema = z
  .object({
    name: z.string().min(1).max(128),
    type: z.string().min(1).max(128),
    text: z.string().max(4_096).optional(),
  })
  .loose();

const versionSchema = z
  .object({
    resources: z
      .object({
        bindings: z.array(bindingSchema),
      })
      .loose(),
  })
  .loose();

const secretsSchema = z.array(
  z
    .object({
      name: z.string().min(1).max(128),
    })
    .loose(),
);

const expectedEnvironmentSchema = z.enum(["staging", "production"]);

const migrationsSchema = z.object({
  checked: z.boolean(),
  current: z.boolean(),
  pendingCount: z.number().int().nonnegative().nullable(),
});

const liveSchema = z.object({
  checked: z.boolean(),
  reachable: z.boolean(),
  publicOverview: z.boolean(),
  health: z.boolean(),
  legalManifest: z.boolean(),
  privateAppProtected: z.boolean(),
  privateApiProtected: z.boolean(),
});

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "VerificationError";
    this.code = code;
  }
}

export function buildWranglerEnvironment(environment) {
  const result = {
    ...environment,
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_WRITE_LOGS: "false",
  };
  delete result.WRANGLER_LOG;
  delete result.WRANGLER_LOG_PATH;
  return result;
}

function wranglerEnvironment() {
  return buildWranglerEnvironment(process.env);
}

function runWranglerJson(label, args) {
  const result = spawnSync("wrangler", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: wranglerEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new VerificationError(`${label}_COMMAND_FAILED`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new VerificationError(`${label}_INVALID_JSON`);
  }
}

function runMigrationCheck(configPath) {
  if (!existsSync(configPath)) {
    return { checked: false, current: false, pendingCount: null };
  }
  const result = spawnSync(
    "wrangler",
    ["d1", "migrations", "list", "DB", "--remote", "--config", configPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: wranglerEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    throw new VerificationError("MIGRATIONS_COMMAND_FAILED");
  }
  return summarizeMigrations(result.stdout);
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0 || !pattern.test(value)) {
    throw new VerificationError(`INVALID_${name}`);
  }
  return value;
}

function resolvePrivateConfigPath(rawPath) {
  const candidate = rawPath?.trim() || "wrangler.deploy.json";
  const absolutePath = resolve(candidate);
  const relativePath = relative(process.cwd(), absolutePath);
  if (relativePath === "wrangler.deploy.json") {
    return absolutePath;
  }
  if (relativePath === "" || isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new VerificationError("INVALID_DEPLOY_CONFIG_PATH");
  }
  if (!/^wrangler\.[a-z0-9-]+\.json$/.test(relativePath)) {
    throw new VerificationError("INVALID_DEPLOY_CONFIG_PATH");
  }
  return absolutePath;
}

function parsePublicOrigin(rawValue) {
  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }
  let url;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new VerificationError("INVALID_DEPLOY_PUBLIC_URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new VerificationError("INVALID_DEPLOY_PUBLIC_URL");
  }
  return url.origin;
}

function newestDeployment(deployments) {
  return deployments.reduce((current, candidate) =>
    Date.parse(candidate.created_on) > Date.parse(current.created_on) ? candidate : current,
  );
}

function activeVersionId(deployment) {
  return deployment.versions.reduce((current, candidate) =>
    candidate.percentage > current.percentage ? candidate : current,
  ).version_id;
}

export function selectActiveVersionId(deployments) {
  const parsedDeployments = deploymentsSchema.parse(deployments);
  return activeVersionId(newestDeployment(parsedDeployments));
}

function plainText(bindings, name) {
  const binding = bindings.find(
    (candidate) => candidate.name === name && candidate.type === "plain_text",
  );
  return binding?.text;
}

function hasBinding(bindings, name) {
  return bindings.some((binding) => binding.name === name);
}

function validAccessDomain(value) {
  if (value === undefined || /change[-_ ]?me/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.hostname.endsWith(".cloudflareaccess.com")
    );
  } catch {
    return false;
  }
}

function validAudience(value) {
  return value !== undefined && /^[A-Za-z0-9_-]{64}$/.test(value) && !/change[-_ ]?me/i.test(value);
}

function validLegalContact(value) {
  return (
    value !== undefined && z.email().safeParse(value).success && !reservedContactPattern.test(value)
  );
}

function featureFlag(bindings, name) {
  const value = plainText(bindings, name);
  return value === "true" ? true : value === "false" ? false : null;
}

export function summarizeMigrations(output) {
  const pending = new Set(output.match(/\b\d{4}_[A-Za-z0-9_-]+\.sql\b/g) ?? []);
  const current = /No migrations to apply/i.test(output) && pending.size === 0;
  return { checked: true, current, pendingCount: pending.size };
}

export function buildDeploymentReport({
  deployments,
  version,
  secrets,
  migrations,
  expectedEnvironment,
  live,
}) {
  const parsedDeployments = deploymentsSchema.parse(deployments);
  const parsedVersion = versionSchema.parse(version);
  const parsedSecrets = secretsSchema.parse(secrets);
  const parsedEnvironment = expectedEnvironmentSchema.parse(expectedEnvironment);
  const parsedMigrations = migrationsSchema.parse(migrations);
  const bindings = parsedVersion.resources.bindings;
  const secretNames = new Set(parsedSecrets.map(({ name }) => name));

  const bindingStatus = {
    assets: hasBinding(bindings, "ASSETS"),
    d1: hasBinding(bindings, "DB"),
    privateR2: hasBinding(bindings, "AUDIO_BUCKET"),
    workflow: hasBinding(bindings, "GENERATION_WORKFLOW"),
    rateLimit: hasBinding(bindings, "JOB_RATE_LIMITER"),
  };
  const runtimeStatus = {
    expectedEnvironment: plainText(bindings, "APP_ENV") === parsedEnvironment,
    accessConfigured:
      validAccessDomain(plainText(bindings, "ACCESS_TEAM_DOMAIN")) &&
      validAudience(plainText(bindings, "ACCESS_AUD")),
    legalContactConfigured: validLegalContact(plainText(bindings, "LEGAL_CONTACT_EMAIL")),
    generationProviderConfigured: ["mock", "fal"].includes(
      plainText(bindings, "GENERATION_PROVIDER") ?? "",
    ),
    r2TransferEnabled: featureFlag(bindings, "R2_TRANSFER_ENABLED"),
    workflowEnabled: featureFlag(bindings, "JOB_WORKFLOW_ENABLED"),
    retentionEnabled: featureFlag(bindings, "RETENTION_CLEANUP_ENABLED"),
    realGenerationEnabled: featureFlag(bindings, "REAL_GENERATION_ENABLED"),
  };
  const secretStatus = {
    r2SigningPair:
      secretNames.has("R2_S3_ACCESS_KEY_ID") && secretNames.has("R2_S3_SECRET_ACCESS_KEY"),
    falProviderPair: secretNames.has("FAL_KEY") && secretNames.has("FAL_WEBHOOK_USER_ID"),
    turnstile: secretNames.has("TURNSTILE_SECRET_KEY"),
  };

  const liveStatus = liveSchema.parse(
    live ?? {
      checked: false,
      reachable: false,
      publicOverview: false,
      health: false,
      legalManifest: false,
      privateAppProtected: false,
      privateApiProtected: false,
    },
  );
  const publicSurface =
    bindingStatus.assets &&
    bindingStatus.d1 &&
    runtimeStatus.expectedEnvironment &&
    runtimeStatus.legalContactConfigured &&
    parsedMigrations.current &&
    liveStatus.checked &&
    liveStatus.reachable &&
    liveStatus.publicOverview &&
    liveStatus.health &&
    liveStatus.legalManifest;
  const privateMock =
    publicSurface &&
    runtimeStatus.accessConfigured &&
    bindingStatus.privateR2 &&
    bindingStatus.workflow &&
    secretStatus.r2SigningPair &&
    runtimeStatus.r2TransferEnabled === true &&
    runtimeStatus.workflowEnabled === true &&
    runtimeStatus.retentionEnabled === true &&
    liveStatus.privateAppProtected &&
    liveStatus.privateApiProtected;
  const realProvider =
    privateMock &&
    bindingStatus.rateLimit &&
    secretStatus.falProviderPair &&
    secretStatus.turnstile &&
    plainText(bindings, "GENERATION_PROVIDER") === "fal" &&
    runtimeStatus.realGenerationEnabled === true;

  return {
    schemaVersion: 1,
    activeDeployment: newestDeployment(parsedDeployments).versions.length > 0,
    bindings: bindingStatus,
    runtime: runtimeStatus,
    secrets: secretStatus,
    migrations: parsedMigrations,
    live: liveStatus,
    readiness: {
      publicSurface,
      privateMock,
      realProvider,
    },
  };
}

async function checkLiveOrigin(origin) {
  if (origin === undefined) {
    return undefined;
  }
  const checks = [
    ["publicOverview", "/", new Set([200])],
    ["health", "/health", new Set([200])],
    ["legalManifest", "/legal/documents.json", new Set([200])],
    ["privateAppProtected", "/app", new Set([302, 303, 401, 403])],
    ["privateApiProtected", "/api/auth/me", new Set([302, 303, 401, 403])],
  ];
  const result = {
    checked: true,
    reachable: true,
    publicOverview: false,
    health: false,
    legalManifest: false,
    privateAppProtected: false,
    privateApiProtected: false,
  };
  try {
    for (const [name, path, acceptedStatuses] of checks) {
      const response = await globalThis.fetch(`${origin}${path}`, {
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(10_000),
      });
      result[name] = acceptedStatuses.has(response.status);
      await response.body?.cancel();
    }
  } catch {
    result.reachable = false;
  }
  return result;
}

async function main() {
  const workerName = requiredEnvironment("DEPLOY_WORKER_NAME", workerNamePattern);
  const expectedEnvironment = expectedEnvironmentSchema.parse(
    process.env.DEPLOY_EXPECT_ENV?.trim() || "production",
  );
  const configPath = resolvePrivateConfigPath(process.env.DEPLOY_CONFIG_PATH);
  const publicOrigin = parsePublicOrigin(process.env.DEPLOY_PUBLIC_URL);

  const deployments = deploymentsSchema.parse(
    runWranglerJson("DEPLOYMENTS", ["deployments", "list", "--name", workerName, "--json"]),
  );
  const versionId = selectActiveVersionId(deployments);
  const version = versionSchema.parse(
    runWranglerJson("VERSION", ["versions", "view", versionId, "--name", workerName, "--json"]),
  );
  const secrets = secretsSchema.parse(
    runWranglerJson("SECRETS", ["secret", "list", "--name", workerName, "--format", "json"]),
  );
  const migrations = runMigrationCheck(configPath);
  const live = await checkLiveOrigin(publicOrigin);
  const report = buildDeploymentReport({
    deployments,
    version,
    secrets,
    migrations,
    expectedEnvironment,
    live,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.readiness.publicSurface) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main().catch((error) => {
    const code =
      error instanceof VerificationError ? error.code : "UNEXPECTED_VERIFICATION_FAILURE";
    process.stderr.write(`Cloudflare deployment verification failed: ${code}\n`);
    process.exitCode = 1;
  });
}
