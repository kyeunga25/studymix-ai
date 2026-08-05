import { createHash } from "node:crypto";
import console from "node:console";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const apiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localSubject = "local-ai-development-owner";
const issuer = "urn:studymix:development";
const subjectHash = createHash("sha256").update(`${issuer}\u0000${localSubject}`).digest("hex");
const ownerId = `own_${subjectHash.slice(0, 32)}`;
const eventId = `evt_${createHash("sha256").update("studymix-local-ai-grant-v1").digest("hex").slice(0, 32)}`;
const timestamp = new Date().toISOString();
const localSchemaPath = path.join(
  apiDirectory,
  "test",
  "local-ai-migrations",
  "0001_local_ai_runtime.sql",
);

function runWrangler(arguments_) {
  const outcome = spawnSync("pnpm", ["exec", "wrangler", ...arguments_], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_WRITE_LOGS: "false",
    },
    stdio: "inherit",
  });
  if (outcome.status !== 0) {
    process.exit(outcome.status ?? 1);
  }
}

function runWranglerJson(arguments_) {
  const outcome = spawnSync("pnpm", ["exec", "wrangler", ...arguments_], {
    cwd: apiDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_WRITE_LOGS: "false",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (outcome.status !== 0) {
    process.exit(outcome.status ?? 1);
  }
  try {
    return JSON.parse(outcome.stdout);
  } catch {
    throw new Error("The local D1 schema check returned an invalid response.");
  }
}

function countLocalSchemaObjects(names) {
  const quotedNames = names.map((name) => `'${name}'`).join(", ");
  const result = runWranglerJson([
    "d1",
    "execute",
    "DB",
    "--local",
    "--json",
    "--command",
    `SELECT COUNT(*) AS total FROM sqlite_master WHERE name IN (${quotedNames});`,
  ]);
  const total = result?.[0]?.results?.[0]?.total;
  if (typeof total !== "number") {
    throw new Error("The local D1 schema check did not return a count.");
  }
  return total;
}

function ensureMigrationGroup(names, migrationFilename) {
  const existingCount = countLocalSchemaObjects(names);
  if (existingCount === 0) {
    runWrangler([
      "d1",
      "execute",
      "DB",
      "--local",
      "--file",
      path.join(apiDirectory, "migrations", migrationFilename),
    ]);
    return;
  }
  if (existingCount !== names.length) {
    throw new Error(
      `The local D1 schema is partially initialized for ${migrationFilename}; back it up and repair it before continuing.`,
    );
  }
}

ensureMigrationGroup(
  [
    "owners",
    "uploads",
    "jobs",
    "provider_requests",
    "outputs",
    "rights_declarations",
    "usage_events",
  ],
  "0001_metadata_schema.sql",
);
ensureMigrationGroup(["legal_acceptances"], "0002_legal_acceptances.sql");
runWrangler([
  "d1",
  "execute",
  "DB",
  "--local",
  "--file",
  path.join(apiDirectory, "migrations", "0003_jobs_owner_created_index.sql"),
]);
ensureMigrationGroup(
  ["owner_entitlements", "credit_ledger", "credit_balances"],
  "0004_beta_credit_ledger.sql",
);
ensureMigrationGroup(
  ["workspaces", "workspace_memberships", "workspace_controls", "owner_invitations"],
  "0005_owner_workspaces.sql",
);
runWrangler(["d1", "execute", "DB", "--local", "--file", localSchemaPath]);

const seedSql = `
INSERT INTO owners (
  id, kind, auth_issuer, auth_subject_hash, status, created_at, last_seen_at
) VALUES (
  '${ownerId}', 'development', '${issuer}', '${subjectHash}', 'active', '${timestamp}', '${timestamp}'
)
ON CONFLICT (id) DO UPDATE SET status = 'active', last_seen_at = excluded.last_seen_at;

INSERT INTO owner_entitlements (owner_id, plan_code, status, created_at, updated_at)
VALUES ('${ownerId}', 'private-beta', 'active', '${timestamp}', '${timestamp}')
ON CONFLICT (owner_id) DO UPDATE SET status = 'active', updated_at = excluded.updated_at;

INSERT INTO credit_ledger (
  id, owner_id, job_id, event_type, quantity, reference_key, created_at
) VALUES (
  '${eventId}', '${ownerId}', NULL, 'grant', 20, 'local:synthetic:grant:v1', '${timestamp}'
)
ON CONFLICT (owner_id, reference_key) DO NOTHING;
`;

runWrangler(["d1", "execute", "DB", "--local", "--command", seedSql]);
console.log("Local synthetic owner, entitlement, and credits are ready.");
