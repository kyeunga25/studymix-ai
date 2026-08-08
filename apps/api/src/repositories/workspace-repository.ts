import { ownerIdSchema, workspaceIdSchema } from "@studymix/contracts";
import { z } from "zod";
import type { OwnerContext } from "../auth/owner-context";
import { upsertOwner } from "./owner-repository";

const identityHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const workspaceAccessRowSchema = z.object({
  ai_job_approval_mode: z.literal("manual"),
  max_job_credit_cost: z.number().int().positive().max(1_000),
  membership_status: z.enum(["active", "disabled"]),
  owner_id: ownerIdSchema,
  owner_status: z.enum(["active", "disabled"]),
  payment_status: z.enum(["disabled", "review_required", "approved"]),
  real_provider_status: z.enum(["disabled", "review_required", "approved"]),
  role: z.literal("owner"),
  workspace_id: workspaceIdSchema,
  workspace_status: z.enum(["active", "disabled"]),
});

export const workspacePermissions = [
  "workspace:read",
  "workspace:manage",
  "jobs:create",
  "jobs:read",
  "credits:read",
  "approvals:manage",
] as const;

export type WorkspacePermission = (typeof workspacePermissions)[number];

export type WorkspaceAccess = {
  aiJobApprovalMode: "manual";
  maxJobCreditCost: number;
  membershipStatus: "active";
  ownerId: string;
  ownerStatus: "active";
  paymentStatus: "disabled" | "review_required" | "approved";
  permissions: readonly WorkspacePermission[];
  realProviderStatus: "disabled" | "review_required" | "approved";
  role: "owner";
  workspaceId: string;
  workspaceStatus: "active";
};

export class WorkspaceAccessError extends Error {
  constructor(
    readonly reason: "WORKSPACE_ACCESS_CONFIGURATION_INVALID" | "WORKSPACE_ACCESS_FORBIDDEN",
    readonly status: 403 | 503,
  ) {
    super(reason);
    this.name = "WorkspaceAccessError";
  }
}

async function findWorkspaceAccess(
  db: D1Database,
  owner: OwnerContext,
): Promise<z.infer<typeof workspaceAccessRowSchema> | null> {
  const row = await db
    .prepare(
      `SELECT
        controls.ai_job_approval_mode,
        controls.max_job_credit_cost,
        memberships.status AS membership_status,
        owners.id AS owner_id,
        owners.status AS owner_status,
        controls.payment_status,
        controls.real_provider_status,
        memberships.role,
        workspaces.id AS workspace_id,
        workspaces.status AS workspace_status
      FROM owners
      JOIN workspace_memberships AS memberships
        ON memberships.owner_id = owners.id
       AND memberships.is_default = 1
      JOIN workspaces
        ON workspaces.id = memberships.workspace_id
      JOIN workspace_controls AS controls
        ON controls.workspace_id = workspaces.id
      WHERE owners.auth_issuer = ?1
        AND owners.auth_subject_hash = ?2`,
    )
    .bind(owner.authIssuer, owner.authSubjectHash)
    .first();
  return row === null ? null : workspaceAccessRowSchema.parse(row);
}

function requireActiveWorkspaceAccess(
  row: z.infer<typeof workspaceAccessRowSchema>,
  owner: OwnerContext,
  requestedWorkspaceId: string | null,
): WorkspaceAccess {
  if (
    row.owner_id !== owner.ownerId ||
    row.owner_status !== "active" ||
    row.membership_status !== "active" ||
    row.workspace_status !== "active" ||
    (requestedWorkspaceId !== null && requestedWorkspaceId !== row.workspace_id)
  ) {
    throw new WorkspaceAccessError("WORKSPACE_ACCESS_FORBIDDEN", 403);
  }

  return {
    aiJobApprovalMode: row.ai_job_approval_mode,
    maxJobCreditCost: row.max_job_credit_cost,
    membershipStatus: row.membership_status,
    ownerId: row.owner_id,
    ownerStatus: row.owner_status,
    paymentStatus: row.payment_status,
    permissions: workspacePermissions,
    realProviderStatus: row.real_provider_status,
    role: row.role,
    workspaceId: row.workspace_id,
    workspaceStatus: row.workspace_status,
  };
}

function parseRequestedWorkspaceId(value: string | null): string | null {
  if (value === null || value.length === 0) {
    return null;
  }
  const parsed = workspaceIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkspaceAccessError("WORKSPACE_ACCESS_FORBIDDEN", 403);
  }
  return parsed.data;
}

async function prepareDevelopmentWorkspace(
  db: D1Database,
  owner: OwnerContext,
  now: string,
): Promise<void> {
  const workspaceId = workspaceIdSchema.parse(`wsp_${owner.authSubjectHash.slice(0, 32)}`);
  await upsertOwner(db, owner, now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, status, created_at, updated_at)
         VALUES (?1, 'active', ?2, ?2)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(workspaceId, now),
    db
      .prepare(
        `INSERT INTO workspace_memberships (
          workspace_id, owner_id, role, status, is_default, created_at, updated_at
        ) VALUES (?1, ?2, 'owner', 'active', 1, ?3, ?3)
        ON CONFLICT (workspace_id, owner_id) DO NOTHING`,
      )
      .bind(workspaceId, owner.ownerId, now),
    db
      .prepare(
        `INSERT INTO workspace_controls (
          workspace_id, ai_job_approval_mode, max_job_credit_cost,
          real_provider_status, payment_status, created_at, updated_at
        ) VALUES (?1, 'manual', 1000, 'disabled', 'disabled', ?2, ?2)
        ON CONFLICT (workspace_id) DO NOTHING`,
      )
      .bind(workspaceId, now),
  ]);
}

async function consumeAuthenticatedInvitation(
  db: D1Database,
  owner: OwnerContext,
  now: string,
): Promise<void> {
  const identityHash = identityHashSchema.safeParse(owner.invitationIdentityHash);
  if (!identityHash.success) {
    throw new WorkspaceAccessError("WORKSPACE_ACCESS_CONFIGURATION_INVALID", 503);
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO owners (
          id, kind, auth_issuer, auth_subject_hash, status, created_at, last_seen_at
        )
        SELECT ?1, 'authenticated', ?2, ?3, 'active', ?5, ?5
        FROM owner_invitations
        WHERE login_identity_hash = ?4
          AND status = 'pending'
        ON CONFLICT (auth_issuer, auth_subject_hash) DO UPDATE SET
          status = 'active',
          last_seen_at = excluded.last_seen_at`,
      )
      .bind(owner.ownerId, owner.authIssuer, owner.authSubjectHash, identityHash.data, now),
    db
      .prepare(
        `INSERT INTO workspaces (id, status, created_at, updated_at)
        SELECT workspace_id, 'active', ?2, ?2
        FROM owner_invitations
        WHERE login_identity_hash = ?1
          AND status = 'pending'
        ON CONFLICT (id) DO NOTHING`,
      )
      .bind(identityHash.data, now),
    db
      .prepare(
        `INSERT INTO workspace_memberships (
          workspace_id, owner_id, role, status, is_default, created_at, updated_at
        )
        SELECT invitations.workspace_id, owners.id, invitations.role, 'active', 1, ?3, ?3
        FROM owner_invitations AS invitations
        JOIN owners ON owners.id = ?2
        WHERE invitations.login_identity_hash = ?1
          AND invitations.status = 'pending'
        ON CONFLICT (workspace_id, owner_id) DO NOTHING`,
      )
      .bind(identityHash.data, owner.ownerId, now),
    db
      .prepare(
        `INSERT INTO workspace_controls (
          workspace_id, ai_job_approval_mode, max_job_credit_cost,
          real_provider_status, payment_status, created_at, updated_at
        )
        SELECT workspace_id, 'manual', max_job_credit_cost,
          'disabled', 'disabled', ?2, ?2
        FROM owner_invitations
        WHERE login_identity_hash = ?1
          AND status = 'pending'
        ON CONFLICT (workspace_id) DO NOTHING`,
      )
      .bind(identityHash.data, now),
    db
      .prepare(
        `INSERT INTO owner_entitlements (
          owner_id, plan_code, status, created_at, updated_at
        )
        SELECT owners.id, 'private-beta', 'active', ?3, ?3
        FROM owner_invitations AS invitations
        JOIN owners ON owners.id = ?2
        WHERE invitations.login_identity_hash = ?1
          AND invitations.status = 'pending'
        ON CONFLICT (owner_id) DO NOTHING`,
      )
      .bind(identityHash.data, owner.ownerId, now),
    db
      .prepare(
        `INSERT INTO credit_ledger (
          id, owner_id, job_id, event_type, quantity, reference_key, created_at
        )
        SELECT
          'evt_' || substr(invitations.id, 5),
          owners.id,
          NULL,
          'grant',
          invitations.initial_credit_grant,
          'onboarding:' || invitations.id,
          ?3
        FROM owner_invitations AS invitations
        JOIN owners ON owners.id = ?2
        WHERE invitations.login_identity_hash = ?1
          AND invitations.status = 'pending'
          AND invitations.initial_credit_grant > 0
        ON CONFLICT (owner_id, reference_key) DO NOTHING`,
      )
      .bind(identityHash.data, owner.ownerId, now),
    db
      .prepare(
        `UPDATE owner_invitations
         SET status = 'consumed', claimed_owner_id = ?2,
           updated_at = ?3, consumed_at = ?3
         WHERE login_identity_hash = ?1
           AND status = 'pending'
           AND EXISTS (
             SELECT 1
             FROM workspace_memberships
             WHERE owner_id = ?2
               AND workspace_id = owner_invitations.workspace_id
               AND status = 'active'
           )`,
      )
      .bind(identityHash.data, owner.ownerId, now),
  ]);
}

export async function authorizeWorkspaceAccess(
  db: D1Database,
  owner: OwnerContext,
  requestedWorkspaceHeader: string | null,
  now: string,
): Promise<WorkspaceAccess> {
  const requestedWorkspaceId = parseRequestedWorkspaceId(requestedWorkspaceHeader);
  let row = await findWorkspaceAccess(db, owner);

  if (row === null) {
    if (owner.kind === "development") {
      await prepareDevelopmentWorkspace(db, owner, now);
    } else {
      await consumeAuthenticatedInvitation(db, owner, now);
    }
    row = await findWorkspaceAccess(db, owner);
  }

  if (row === null) {
    throw new WorkspaceAccessError("WORKSPACE_ACCESS_FORBIDDEN", 403);
  }

  const access = requireActiveWorkspaceAccess(row, owner, requestedWorkspaceId);
  await db
    .prepare(
      `UPDATE owners
       SET last_seen_at = ?1
       WHERE id = ?2
         AND status = 'active'`,
    )
    .bind(now, access.ownerId)
    .run();
  return access;
}
