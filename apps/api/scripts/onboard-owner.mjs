import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { resolveProtectedConfigPath } from "./create-cloudflare-config.mjs";

const INVITATION_HASH_CONTEXT = "studymix-owner-invite-v1";
const loginIdentitySchema = z.string().trim().toLowerCase().pipe(z.email());
const identityPepperSchema = z
  .string()
  .trim()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => !/change[-_ ]?me/i.test(value));
const creditGrantSchema = z.coerce.number().int().min(0).max(100_000);
const maxJobCreditCostSchema = z.coerce.number().int().positive().max(1_000);
const timestampSchema = z.iso.datetime({ offset: true });
const invitationIdSchema = z.string().regex(/^inv_[0-9a-f]{32}$/);
const workspaceIdSchema = z.string().regex(/^wsp_[0-9a-f]{32}$/);
const identityHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export function hashOwnerLoginIdentity(loginIdentity, pepper) {
  const identity = loginIdentitySchema.parse(loginIdentity);
  const parsedPepper = identityPepperSchema.parse(pepper);
  return createHmac("sha256", parsedPepper)
    .update(`${INVITATION_HASH_CONTEXT}\u0000${identity}`, "utf8")
    .digest("hex");
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildOwnerOnboardingSql(input) {
  const parsed = z
    .object({
      identityHash: identityHashSchema,
      initialCreditGrant: creditGrantSchema,
      invitationId: invitationIdSchema,
      maxJobCreditCost: maxJobCreditCostSchema,
      timestamp: timestampSchema,
      workspaceId: workspaceIdSchema,
    })
    .parse(input);
  const identityHash = sqlString(parsed.identityHash);
  const invitationId = sqlString(parsed.invitationId);
  const timestamp = sqlString(parsed.timestamp);
  const workspaceId = sqlString(parsed.workspaceId);

  return `INSERT INTO owner_invitations (
  id, login_identity_hash, workspace_id, role, status,
  initial_credit_grant, max_job_credit_cost, created_at, updated_at
) VALUES (
  ${invitationId}, ${identityHash}, ${workspaceId}, 'owner', 'pending',
  ${parsed.initialCreditGrant}, ${parsed.maxJobCreditCost}, ${timestamp}, ${timestamp}
)
ON CONFLICT (login_identity_hash) DO UPDATE SET
  initial_credit_grant = excluded.initial_credit_grant,
  max_job_credit_cost = excluded.max_job_credit_cost,
  status = CASE
    WHEN owner_invitations.status = 'revoked' THEN 'pending'
    ELSE owner_invitations.status
  END,
  updated_at = excluded.updated_at;

UPDATE owners
SET status = 'active', last_seen_at = ${timestamp}
WHERE id = (
  SELECT claimed_owner_id
  FROM owner_invitations
  WHERE login_identity_hash = ${identityHash}
    AND status = 'consumed'
);

UPDATE workspaces
SET status = 'active', updated_at = ${timestamp}
WHERE id = (
  SELECT workspace_id
  FROM owner_invitations
  WHERE login_identity_hash = ${identityHash}
    AND status = 'consumed'
);

UPDATE workspace_memberships
SET role = 'owner', status = 'active', is_default = 1, updated_at = ${timestamp}
WHERE owner_id = (
  SELECT claimed_owner_id
  FROM owner_invitations
  WHERE login_identity_hash = ${identityHash}
    AND status = 'consumed'
)
AND workspace_id = (
  SELECT workspace_id
  FROM owner_invitations
  WHERE login_identity_hash = ${identityHash}
    AND status = 'consumed'
);

UPDATE workspace_controls
SET ai_job_approval_mode = 'manual',
  max_job_credit_cost = ${parsed.maxJobCreditCost},
  real_provider_status = 'disabled',
  payment_status = 'disabled',
  updated_at = ${timestamp}
WHERE workspace_id = (
  SELECT workspace_id
  FROM owner_invitations
  WHERE login_identity_hash = ${identityHash}
    AND status = 'consumed'
);

UPDATE owner_entitlements
SET status = 'active', updated_at = ${timestamp}
WHERE owner_id = (
  SELECT claimed_owner_id
  FROM owner_invitations
  WHERE login_identity_hash = ${identityHash}
    AND status = 'consumed'
);

INSERT INTO credit_ledger (
  id, owner_id, job_id, event_type, quantity, reference_key, created_at
)
SELECT
  'evt_' || substr(invitations.id, 5),
  invitations.claimed_owner_id,
  NULL,
  'grant',
  invitations.initial_credit_grant,
  'onboarding:' || invitations.id,
  ${timestamp}
FROM owner_invitations AS invitations
WHERE invitations.login_identity_hash = ${identityHash}
  AND invitations.status = 'consumed'
  AND invitations.initial_credit_grant > 0
ON CONFLICT (owner_id, reference_key) DO NOTHING;
`;
}

export function buildOwnerOnboardingArgs(configPath, sqlPath) {
  return ["d1", "execute", "DB", "--remote", "--config", configPath, "--file", sqlPath];
}

export function buildOwnerOnboardingEnvironment(environment) {
  const result = {
    ...environment,
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_WRITE_LOGS: "false",
  };
  delete result.WRANGLER_LOG;
  delete result.WRANGLER_LOG_PATH;
  delete result.OWNER_LOGIN_IDENTITY;
  delete result.OWNER_IDENTITY_PEPPER;
  return result;
}

function main() {
  const identityHash = hashOwnerLoginIdentity(
    process.env.OWNER_LOGIN_IDENTITY,
    process.env.OWNER_IDENTITY_PEPPER,
  );
  const initialCreditGrant = creditGrantSchema.parse(process.env.OWNER_BETA_CREDITS ?? "10");
  const maxJobCreditCost = maxJobCreditCostSchema.parse(
    process.env.OWNER_MAX_JOB_CREDIT_COST ?? "2",
  );
  const configPath = resolveProtectedConfigPath(process.env.DEPLOY_CONFIG_PATH);
  const timestamp = new Date().toISOString();
  const invitationId = `inv_${randomBytes(16).toString("hex")}`;
  const workspaceId = `wsp_${randomBytes(16).toString("hex")}`;
  const sql = buildOwnerOnboardingSql({
    identityHash,
    initialCreditGrant,
    invitationId,
    maxJobCreditCost,
    timestamp,
    workspaceId,
  });
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "studymix-owner-onboard-"));
  const sqlPath = join(temporaryDirectory, "onboarding.sql");

  try {
    writeFileSync(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
    const result = spawnSync("wrangler", buildOwnerOnboardingArgs(configPath, sqlPath), {
      cwd: process.cwd(),
      env: buildOwnerOnboardingEnvironment(process.env),
      stdio: "ignore",
    });
    if (result.status !== 0 || result.error !== undefined) {
      throw new Error("PRIVATE_OWNER_ONBOARDING_FAILED");
    }
    process.stdout.write(
      `${JSON.stringify({ identityEchoed: false, ownerInviteConfigured: true })}\n`,
    );
  } finally {
    try {
      unlinkSync(sqlPath);
    } catch {
      // The generic failure path must not expose a private temporary filename.
    }
    try {
      rmdirSync(temporaryDirectory);
    } catch {
      // The directory contains at most the single onboarding SQL file above.
    }
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  try {
    main();
  } catch {
    process.stderr.write("Private owner onboarding failed without exposing protected input.\n");
    process.exitCode = 1;
  }
}
