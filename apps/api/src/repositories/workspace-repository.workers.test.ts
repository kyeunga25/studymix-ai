import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { OwnerContext } from "../auth/owner-context";
import { getOwnedCreditSummary } from "./credit-repository";
import { authorizeWorkspaceAccess, WorkspaceAccessError } from "./workspace-repository";

const now = "2026-08-05T00:00:00.000Z";
const authenticatedOwner: OwnerContext = {
  authIssuer: "https://example-team.cloudflareaccess.com",
  authSubjectHash: "1".repeat(64),
  invitationIdentityHash: "2".repeat(64),
  kind: "authenticated",
  ownerId: `own_${"1".repeat(32)}`,
};

async function insertInvitation(status: "pending" | "revoked" = "pending"): Promise<string> {
  const workspaceId = `wsp_${"3".repeat(32)}`;
  await env.DB.prepare(
    `INSERT INTO owner_invitations (
      id, login_identity_hash, workspace_id, role, status,
      initial_credit_grant, max_job_credit_cost, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 'owner', ?4, 10, 2, ?5, ?5)`,
  )
    .bind(
      `inv_${"4".repeat(32)}`,
      authenticatedOwner.invitationIdentityHash,
      workspaceId,
      status,
      now,
    )
    .run();
  return workspaceId;
}

describe("workspace authorization repository", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM credit_ledger").run();
    await env.DB.prepare("DELETE FROM owner_entitlements").run();
    await env.DB.prepare("DELETE FROM workspace_memberships").run();
    await env.DB.prepare("DELETE FROM workspace_controls").run();
    await env.DB.prepare("DELETE FROM owner_invitations").run();
    await env.DB.prepare("DELETE FROM workspaces").run();
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("denies an authenticated but uninvited identity without creating owner state", async () => {
    await expect(
      authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now),
    ).rejects.toMatchObject({
      reason: "WORKSPACE_ACCESS_FORBIDDEN",
      status: 403,
    });
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM owners) AS owners,
        (SELECT COUNT(*) FROM workspaces) AS workspaces,
        (SELECT COUNT(*) FROM workspace_memberships) AS memberships`,
    ).first<{ memberships: number; owners: number; workspaces: number }>();
    expect(counts).toEqual({ memberships: 0, owners: 0, workspaces: 0 });
  });

  it("atomically consumes an invitation into one active owner workspace and bounded credits", async () => {
    const workspaceId = await insertInvitation();
    const first = await authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now);
    const second = await authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      aiJobApprovalMode: "manual",
      maxJobCreditCost: 2,
      membershipStatus: "active",
      ownerStatus: "active",
      paymentStatus: "disabled",
      realProviderStatus: "disabled",
      role: "owner",
      workspaceId,
      workspaceStatus: "active",
    });
    expect(first.permissions).toEqual(
      expect.arrayContaining(["workspace:manage", "credits:read", "approvals:manage"]),
    );
    await expect(getOwnedCreditSummary(env.DB, authenticatedOwner.ownerId)).resolves.toMatchObject({
      availableCredits: 10,
      status: "active",
    });
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM owners) AS owners,
        (SELECT COUNT(*) FROM workspaces) AS workspaces,
        (SELECT COUNT(*) FROM workspace_memberships) AS memberships,
        (SELECT COUNT(*) FROM credit_ledger WHERE event_type = 'grant') AS grants,
        (SELECT COUNT(*) FROM owner_invitations WHERE status = 'consumed') AS consumed`,
    ).first<{
      consumed: number;
      grants: number;
      memberships: number;
      owners: number;
      workspaces: number;
    }>();
    expect(counts).toEqual({ consumed: 1, grants: 1, memberships: 1, owners: 1, workspaces: 1 });
  });

  it("rejects disabled accounts and memberships after successful onboarding", async () => {
    await insertInvitation();
    const access = await authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now);

    await env.DB.prepare("UPDATE owners SET status = 'disabled' WHERE id = ?1")
      .bind(authenticatedOwner.ownerId)
      .run();
    await expect(
      authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now),
    ).rejects.toBeInstanceOf(WorkspaceAccessError);

    await env.DB.prepare("UPDATE owners SET status = 'active' WHERE id = ?1")
      .bind(authenticatedOwner.ownerId)
      .run();
    await env.DB.prepare(
      "UPDATE workspace_memberships SET status = 'disabled' WHERE workspace_id = ?1",
    )
      .bind(access.workspaceId)
      .run();
    await expect(
      authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now),
    ).rejects.toMatchObject({ reason: "WORKSPACE_ACCESS_FORBIDDEN", status: 403 });
  });

  it("reactivates an existing disabled owner only when a fresh invitation is consumed", async () => {
    await env.DB.prepare(
      `INSERT INTO owners (
        id, kind, auth_issuer, auth_subject_hash, status, created_at, last_seen_at
      ) VALUES (?1, 'authenticated', ?2, ?3, 'disabled', ?4, ?4)`,
    )
      .bind(
        authenticatedOwner.ownerId,
        authenticatedOwner.authIssuer,
        authenticatedOwner.authSubjectHash,
        now,
      )
      .run();
    await insertInvitation();

    await expect(
      authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now),
    ).resolves.toMatchObject({ ownerStatus: "active", workspaceStatus: "active" });
  });

  it("rejects any client request that asserts a different workspace", async () => {
    await insertInvitation();
    await authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now);

    await expect(
      authorizeWorkspaceAccess(env.DB, authenticatedOwner, `wsp_${"9".repeat(32)}`, now),
    ).rejects.toMatchObject({ reason: "WORKSPACE_ACCESS_FORBIDDEN", status: 403 });
  });

  it("does not consume a revoked invitation", async () => {
    await insertInvitation("revoked");
    await expect(
      authorizeWorkspaceAccess(env.DB, authenticatedOwner, null, now),
    ).rejects.toMatchObject({ reason: "WORKSPACE_ACCESS_FORBIDDEN", status: 403 });
    const invitation = await env.DB.prepare(
      "SELECT status, claimed_owner_id FROM owner_invitations",
    ).first<{ claimed_owner_id: string | null; status: string }>();
    expect(invitation).toEqual({ claimed_owner_id: null, status: "revoked" });
  });

  it("keeps credential-free development access isolated from the production invite gate", async () => {
    const developmentOwner: OwnerContext = {
      authIssuer: "urn:studymix:development",
      authSubjectHash: "5".repeat(64),
      invitationIdentityHash: null,
      kind: "development",
      ownerId: `own_${"5".repeat(32)}`,
    };
    const access = await authorizeWorkspaceAccess(env.DB, developmentOwner, null, now);
    expect(access).toMatchObject({
      membershipStatus: "active",
      ownerStatus: "active",
      role: "owner",
      workspaceStatus: "active",
    });
    const invitationCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM owner_invitations",
    ).first<{ total: number }>();
    expect(invitationCount?.total).toBe(0);
  });
});
