import { createSecureId } from "@studymix/core";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { OwnerContext } from "../auth/owner-context";
import {
  RepositoryConflictError,
  RepositoryLegalAcceptanceRequiredError,
  RepositoryNotFoundError,
  RepositoryStateError,
  confirmOwnedUpload,
  createJobIdempotently,
  createOutput,
  createProviderRequest,
  createUpload,
  getCurrentLegalAcceptanceStatus,
  getOwnedJob,
  getOwnedOutput,
  recordRightsDeclaration,
  recordCurrentLegalAcceptances,
  recordUsageEvent,
  hasCurrentLegalAcceptances,
  transitionOwnedJob,
  upsertOwner,
} from "./index";

const now = "2026-07-24T10:00:00.000Z";
const later = "2026-07-31T10:00:00.000Z";

function ownerContext(seed: "1" | "2"): OwnerContext {
  return {
    authIssuer: "https://example-team.cloudflareaccess.com",
    authSubjectHash: seed.repeat(64),
    kind: "authenticated",
    ownerId: `own_${seed.repeat(32)}`,
  };
}

async function createConfirmedUpload(
  owner: OwnerContext,
  withLegalAcceptance = true,
): Promise<string> {
  await upsertOwner(env.DB, owner, now);
  if (withLegalAcceptance) {
    await recordCurrentLegalAcceptances(env.DB, owner.ownerId, now);
  }
  const uploadId = createSecureId("upl");
  await createUpload(env.DB, {
    createdAt: now,
    declaredContentType: "audio/mpeg",
    expiresAt: later,
    id: uploadId,
    maxActiveUploads: 3,
    objectKey: `owners/${owner.ownerId}/uploads/${uploadId}`,
    originalFilename: "fixture.mp3",
    ownerId: owner.ownerId,
    sizeBytes: 1024,
  });
  await confirmOwnedUpload(env.DB, owner.ownerId, uploadId, 1024, now);
  return uploadId;
}

describe("D1 repositories", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM legal_acceptances").run();
    await env.DB.prepare("DELETE FROM usage_events").run();
    await env.DB.prepare("DELETE FROM rights_declarations").run();
    await env.DB.prepare("DELETE FROM outputs").run();
    await env.DB.prepare("DELETE FROM provider_requests").run();
    await env.DB.prepare("DELETE FROM jobs").run();
    await env.DB.prepare("DELETE FROM uploads").run();
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("returns the existing job for a duplicate owner-scoped idempotency key", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const input = {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-0001",
      ownerId: owner.ownerId,
      presetId: "soft-piano" as const,
      presetVersion: 1,
      provider: "mock" as const,
      requestFingerprint: "a".repeat(64),
      uploadId,
    };

    const first = await createJobIdempotently(env.DB, input);
    const second = await createJobIdempotently(env.DB, {
      ...input,
      id: createSecureId("job"),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("blocks repository-level job creation until current legal versions are accepted", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner, false);

    await expect(
      createJobIdempotently(env.DB, {
        createdAt: now,
        expiresAt: later,
        id: createSecureId("job"),
        idempotencyKey: "job-request-no-legal",
        ownerId: owner.ownerId,
        presetId: "soft-piano",
        presetVersion: 1,
        provider: "mock",
        requestFingerprint: "9".repeat(64),
        uploadId,
      }),
    ).rejects.toBeInstanceOf(RepositoryLegalAcceptanceRequiredError);

    const rowCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM jobs").first<{
      total: number;
    }>();
    expect(rowCount?.total).toBe(0);
  });

  it("rejects reusing an idempotency key for a different request", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const input = {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-0002",
      ownerId: owner.ownerId,
      presetId: "soft-piano" as const,
      presetVersion: 1,
      provider: "mock" as const,
      requestFingerprint: "a".repeat(64),
      uploadId,
    };
    await createJobIdempotently(env.DB, input);

    await expect(
      createJobIdempotently(env.DB, {
        ...input,
        id: createSecureId("job"),
        requestFingerprint: "b".repeat(64),
      }),
    ).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it("never reads or creates records through another owner", async () => {
    const firstOwner = ownerContext("1");
    const secondOwner = ownerContext("2");
    const uploadId = await createConfirmedUpload(firstOwner);
    await upsertOwner(env.DB, secondOwner, now);
    await recordCurrentLegalAcceptances(env.DB, secondOwner.ownerId, now);
    const created = await createJobIdempotently(env.DB, {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-0003",
      ownerId: firstOwner.ownerId,
      presetId: "music-box",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "c".repeat(64),
      uploadId,
    });

    await expect(
      createJobIdempotently(env.DB, {
        createdAt: now,
        expiresAt: later,
        id: createSecureId("job"),
        idempotencyKey: "job-request-attacker",
        ownerId: secondOwner.ownerId,
        presetId: "music-box",
        presetVersion: 1,
        provider: "mock",
        requestFingerprint: "d".repeat(64),
        uploadId,
      }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(getOwnedJob(env.DB, secondOwner.ownerId, created.job.id)).resolves.toBeNull();
  });

  it("stores current legal versions idempotently and isolates acceptance by owner", async () => {
    const firstOwner = ownerContext("1");
    const secondOwner = ownerContext("2");
    await upsertOwner(env.DB, firstOwner, now);
    await upsertOwner(env.DB, secondOwner, now);

    const first = await recordCurrentLegalAcceptances(env.DB, firstOwner.ownerId, now);
    const repeated = await recordCurrentLegalAcceptances(env.DB, firstOwner.ownerId, later);
    const second = await getCurrentLegalAcceptanceStatus(env.DB, secondOwner.ownerId);
    const rows = await env.DB.prepare(
      "SELECT owner_id, document_id, accepted_at FROM legal_acceptances ORDER BY document_id",
    ).all<{ accepted_at: string; document_id: string; owner_id: string }>();

    expect(first.current).toBe(true);
    expect(repeated).toEqual(first);
    expect(second.current).toBe(false);
    expect(await hasCurrentLegalAcceptances(env.DB, firstOwner.ownerId)).toBe(true);
    expect(await hasCurrentLegalAcceptances(env.DB, secondOwner.ownerId)).toBe(false);
    expect(rows.results).toHaveLength(3);
    expect(rows.results.every((row) => row.owner_id === firstOwner.ownerId)).toBe(true);
    expect(rows.results.every((row) => row.accepted_at === now)).toBe(true);
  });

  it("guards job transitions in both domain logic and the UPDATE predicate", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const created = await createJobIdempotently(env.DB, {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-0004",
      ownerId: owner.ownerId,
      presetId: "lofi-study",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "e".repeat(64),
      uploadId,
    });
    const validating = await transitionOwnedJob(
      env.DB,
      owner.ownerId,
      created.job.id,
      ["created"],
      "validating",
      { completedAt: null, errorCode: null, updatedAt: now },
    );

    expect(validating.status).toBe("validating");
    await expect(
      transitionOwnedJob(env.DB, owner.ownerId, created.job.id, ["validating"], "completed", {
        completedAt: now,
        errorCode: null,
        updatedAt: now,
      }),
    ).rejects.toBeInstanceOf(RepositoryStateError);
  });

  it("keeps provider, output, rights, and usage rows bound to the owning job", async () => {
    const firstOwner = ownerContext("1");
    const secondOwner = ownerContext("2");
    const uploadId = await createConfirmedUpload(firstOwner);
    await upsertOwner(env.DB, secondOwner, now);
    const created = await createJobIdempotently(env.DB, {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-0005",
      ownerId: firstOwner.ownerId,
      presetId: "soft-piano",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "f".repeat(64),
      uploadId,
    });
    await createProviderRequest(env.DB, {
      candidateIndex: 0,
      id: createSecureId("req"),
      jobId: created.job.id,
      ownerId: firstOwner.ownerId,
      provider: "mock",
    });
    const output = await createOutput(env.DB, {
      candidateIndex: 0,
      createdAt: now,
      expiresAt: later,
      id: createSecureId("out"),
      jobId: created.job.id,
      objectKey: `owners/${firstOwner.ownerId}/outputs/0`,
      ownerId: firstOwner.ownerId,
    });
    await recordRightsDeclaration(env.DB, {
      acceptedAt: now,
      declarationVersion: "v1",
      id: createSecureId("rgt"),
      jobId: created.job.id,
      ownerId: firstOwner.ownerId,
      uploadId,
    });
    await recordUsageEvent(env.DB, {
      createdAt: now,
      estimatedCostUsd: 0,
      eventType: "job_created",
      id: createSecureId("evt"),
      jobId: created.job.id,
      ownerId: firstOwner.ownerId,
      quantity: 1,
    });

    await expect(getOwnedOutput(env.DB, firstOwner.ownerId, output.id)).resolves.toMatchObject({
      id: output.id,
    });
    await expect(getOwnedOutput(env.DB, secondOwner.ownerId, output.id)).resolves.toBeNull();
    await expect(
      createProviderRequest(env.DB, {
        candidateIndex: 1,
        id: createSecureId("req"),
        jobId: created.job.id,
        ownerId: secondOwner.ownerId,
        provider: "mock",
      }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
  });

  it("creates the ownership and lookup indexes", async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name IN (
         'idx_jobs_owner',
         'idx_jobs_status',
         'idx_jobs_expiry',
         'idx_legal_acceptances_owner_accepted',
         'idx_provider_requests_provider_id'
       )
       ORDER BY name`,
    ).all<{ name: string }>();

    expect(result.results.map((row) => row.name)).toEqual([
      "idx_jobs_expiry",
      "idx_jobs_owner",
      "idx_jobs_status",
      "idx_legal_acceptances_owner_accepted",
      "idx_provider_requests_provider_id",
    ]);
  });
});
