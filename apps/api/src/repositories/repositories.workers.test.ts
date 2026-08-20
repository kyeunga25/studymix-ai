import { createSecureId } from "@studymix/core";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { OwnerContext } from "../auth/owner-context";
import {
  RepositoryConflictError,
  RepositoryCreditsInsufficientError,
  RepositoryEntitlementRequiredError,
  RepositoryLegalAcceptanceRequiredError,
  RepositoryNotFoundError,
  RepositoryQuotaError,
  RepositoryStateError,
  attachOwnedJobWorkflow,
  confirmOwnedUpload,
  createJobIdempotently,
  completeOwnedJobWithCredits,
  createOutput,
  createProviderRequest,
  createUpload,
  getCurrentLegalAcceptanceStatus,
  getOwnedCreditReservationStatus,
  getOwnedCreditSummary,
  getOwnedJob,
  getOwnedOutput,
  listOwnedJobs,
  listOwnedOutputs,
  markOwnedOutputReady,
  markOwnedProviderRequestCompleted,
  markOwnedProviderRequestSubmitted,
  failOwnedJobWithCreditRelease,
  grantPrivateBetaCredits,
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
    invitationIdentityHash: seed.repeat(64),
    kind: "authenticated",
    ownerId: `own_${seed.repeat(32)}`,
  };
}

async function createConfirmedUpload(
  owner: OwnerContext,
  withLegalAcceptance = true,
  credits = 100,
): Promise<string> {
  await upsertOwner(env.DB, owner, now);
  if (credits > 0) {
    await grantPrivateBetaCredits(env.DB, {
      createdAt: now,
      eventId: createSecureId("evt"),
      ownerId: owner.ownerId,
      quantity: credits,
      referenceKey: `test:grant:${owner.ownerId}`,
    });
  }
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
  await confirmOwnedUpload(
    env.DB,
    owner.ownerId,
    uploadId,
    1024,
    now,
    new Date(new Date(now).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
  );
  return uploadId;
}

describe("D1 repositories", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM legal_acceptances").run();
    await env.DB.prepare("DELETE FROM credit_ledger").run();
    await env.DB.prepare("DELETE FROM owner_entitlements").run();
    await env.DB.prepare("DELETE FROM usage_events").run();
    await env.DB.prepare("DELETE FROM rights_declarations").run();
    await env.DB.prepare("DELETE FROM outputs").run();
    await env.DB.prepare("DELETE FROM provider_requests").run();
    await env.DB.prepare("DELETE FROM jobs").run();
    await env.DB.prepare("DELETE FROM uploads").run();
    await env.DB.prepare("DELETE FROM workspace_memberships").run();
    await env.DB.prepare("DELETE FROM workspace_controls").run();
    await env.DB.prepare("DELETE FROM owner_invitations").run();
    await env.DB.prepare("DELETE FROM workspaces").run();
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("returns a bounded newest-first owner job history without another owner's rows", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const createdJobs = [];
    for (const [index, createdAt] of [
      "2026-07-24T10:00:00.000Z",
      "2026-07-24T11:00:00.000Z",
      "2026-07-24T12:00:00.000Z",
    ].entries()) {
      createdJobs.push(
        await createJobIdempotently(env.DB, {
          createdAt,
          expiresAt: later,
          id: createSecureId("job"),
          idempotencyKey: `history-owner-one-${index.toString()}`,
          maxActiveJobs: 20,
          ownerId: owner.ownerId,
          presetId: index === 1 ? "music-box" : "soft-piano",
          presetVersion: 1,
          provider: "mock",
          requestFingerprint: (index + 1).toString().repeat(64),
          uploadId,
        }),
      );
    }

    const otherOwner = ownerContext("2");
    const otherUploadId = await createConfirmedUpload(otherOwner);
    const otherJob = await createJobIdempotently(env.DB, {
      createdAt: "2026-07-24T13:00:00.000Z",
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "history-owner-two",
      maxActiveJobs: 20,
      ownerId: otherOwner.ownerId,
      presetId: "lofi-study",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "f".repeat(64),
      uploadId: otherUploadId,
    });

    const history = await listOwnedJobs(env.DB, owner.ownerId, 2);

    expect(history.map((job) => job.id)).toEqual([createdJobs[2]?.job.id, createdJobs[1]?.job.id]);
    expect(history).toHaveLength(2);
    expect(history.every((job) => job.id !== otherJob.job.id)).toBe(true);
    expect(history.map((job) => Object.keys(job).sort())).toEqual([
      ["createdAt", "expiresAt", "id", "presetId", "presetVersion", "status", "updatedAt"],
      ["createdAt", "expiresAt", "id", "presetId", "presetVersion", "status", "updatedAt"],
    ]);
  });

  it("returns the existing job for a duplicate owner-scoped idempotency key", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const input = {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-0001",
      maxActiveJobs: 2,
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
    expect(await getOwnedCreditReservationStatus(env.DB, owner.ownerId, first.job.id)).toBe(
      "reserved",
    );
    expect((await getOwnedCreditSummary(env.DB, owner.ownerId))?.availableCredits).toBe(99);
  });

  it("requires an active entitlement and sufficient credits before atomically creating a job", async () => {
    const ownerWithoutEntitlement = ownerContext("1");
    const uploadWithoutEntitlement = await createConfirmedUpload(ownerWithoutEntitlement, true, 0);
    await expect(
      createJobIdempotently(env.DB, {
        createdAt: now,
        creditCost: 2,
        expiresAt: later,
        id: createSecureId("job"),
        idempotencyKey: "job-request-no-entitlement",
        maxActiveJobs: 2,
        ownerId: ownerWithoutEntitlement.ownerId,
        presetId: "soft-piano",
        presetVersion: 1,
        provider: "mock",
        requestFingerprint: "7".repeat(64),
        uploadId: uploadWithoutEntitlement,
      }),
    ).rejects.toBeInstanceOf(RepositoryEntitlementRequiredError);

    const ownerWithOneCredit = ownerContext("2");
    const uploadWithOneCredit = await createConfirmedUpload(ownerWithOneCredit, true, 1);
    await expect(
      createJobIdempotently(env.DB, {
        createdAt: now,
        creditCost: 2,
        expiresAt: later,
        id: createSecureId("job"),
        idempotencyKey: "job-request-insufficient-credit",
        maxActiveJobs: 2,
        ownerId: ownerWithOneCredit.ownerId,
        presetId: "soft-piano",
        presetVersion: 1,
        provider: "mock",
        requestFingerprint: "6".repeat(64),
        uploadId: uploadWithOneCredit,
      }),
    ).rejects.toBeInstanceOf(RepositoryCreditsInsufficientError);

    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM jobs) AS jobs,
        (SELECT COUNT(*) FROM credit_ledger WHERE event_type = 'reserve') AS reserves`,
    ).first<{ jobs: number; reserves: number }>();
    expect(counts).toEqual({ jobs: 0, reserves: 0 });
  });

  it("prevents simultaneous owner jobs from over-reserving credits", async () => {
    const owner = ownerContext("1");
    const firstUploadId = await createConfirmedUpload(owner, true, 2);
    const secondUploadId = await createConfirmedUpload(owner, true, 2);
    const firstRequest = {
      createdAt: now,
      creditCost: 2,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "concurrent-credit-job-a",
      maxActiveJobs: 2,
      ownerId: owner.ownerId,
      presetId: "soft-piano" as const,
      presetVersion: 1,
      provider: "mock" as const,
      requestFingerprint: "a".repeat(64),
      uploadId: firstUploadId,
    };
    const requests = [
      firstRequest,
      {
        createdAt: now,
        creditCost: 2,
        expiresAt: later,
        id: createSecureId("job"),
        idempotencyKey: "concurrent-credit-job-b",
        maxActiveJobs: 2,
        ownerId: owner.ownerId,
        presetId: "music-box" as const,
        presetVersion: 1,
        provider: "mock" as const,
        requestFingerprint: "b".repeat(64),
        uploadId: secondUploadId,
      },
    ];
    const outcomes = await Promise.all(
      requests.map(async (request) => {
        try {
          return { kind: "created", value: await createJobIdempotently(env.DB, request) } as const;
        } catch (error) {
          return { error, kind: "rejected" } as const;
        }
      }),
    );
    const created = outcomes.flatMap((outcome) =>
      outcome.kind === "created" ? [outcome.value] : [],
    );
    const rejected = outcomes.flatMap((outcome) =>
      outcome.kind === "rejected" ? [outcome.error] : [],
    );
    const state = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM jobs WHERE owner_id = ?1) AS jobs,
        (SELECT COUNT(*) FROM rights_declarations WHERE owner_id = ?1) AS rights,
        (SELECT COUNT(*) FROM credit_ledger WHERE owner_id = ?1 AND event_type = 'reserve') AS reserves`,
    )
      .bind(owner.ownerId)
      .first<{ jobs: number; reserves: number; rights: number }>();

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(RepositoryCreditsInsufficientError);
    expect(state).toEqual({ jobs: 1, reserves: 1, rights: 1 });
    expect(await getOwnedCreditSummary(env.DB, owner.ownerId)).toMatchObject({
      availableCredits: 0,
      reservedCredits: 2,
      settledCredits: 0,
    });
    const createdJob = created[0];
    if (createdJob === undefined) {
      throw new Error("The concurrent credit test did not create one owner job.");
    }

    const otherOwner = ownerContext("2");
    const otherUploadId = await createConfirmedUpload(otherOwner, true, 2);
    await expect(
      createJobIdempotently(env.DB, {
        ...firstRequest,
        id: createSecureId("job"),
        idempotencyKey: createdJob.job.idempotencyKey,
        ownerId: otherOwner.ownerId,
        requestFingerprint: "c".repeat(64),
        uploadId: otherUploadId,
      }),
    ).resolves.toMatchObject({ created: true });
    expect(await getOwnedCreditSummary(env.DB, otherOwner.ownerId)).toMatchObject({
      availableCredits: 0,
      reservedCredits: 2,
      settledCredits: 0,
    });
  });

  it("rejects reusing one owner grant reference for a different quantity", async () => {
    const owner = ownerContext("1");
    await upsertOwner(env.DB, owner, now);
    const grant = {
      createdAt: now,
      eventId: createSecureId("evt"),
      ownerId: owner.ownerId,
      quantity: 5,
      referenceKey: "test:grant:quantity-bound",
    };
    await grantPrivateBetaCredits(env.DB, grant);

    await expect(
      grantPrivateBetaCredits(env.DB, {
        ...grant,
        eventId: createSecureId("evt"),
        quantity: 6,
      }),
    ).rejects.toBeInstanceOf(RepositoryConflictError);
    expect(await getOwnedCreditSummary(env.DB, owner.ownerId)).toMatchObject({
      availableCredits: 5,
      reservedCredits: 0,
      settledCredits: 0,
    });
    const recorded = await env.DB.prepare(
      `SELECT event_type, quantity,
        (SELECT COUNT(*) FROM credit_ledger WHERE owner_id = ?1) AS events
       FROM credit_ledger
       WHERE owner_id = ?1 AND reference_key = ?2`,
    )
      .bind(owner.ownerId, grant.referenceKey)
      .first<{ event_type: string; events: number; quantity: number }>();
    expect(recorded).toEqual({ event_type: "grant", events: 1, quantity: 5 });
  });

  it("serializes conflicting grant quantities within one owner reference scope", async () => {
    const owner = ownerContext("1");
    await upsertOwner(env.DB, owner, now);
    const referenceKey = "test:grant:concurrent-quantity";
    const outcomes = await Promise.all(
      [3, 7].map(async (quantity) => {
        try {
          const summary = await grantPrivateBetaCredits(env.DB, {
            createdAt: now,
            eventId: createSecureId("evt"),
            ownerId: owner.ownerId,
            quantity,
            referenceKey,
          });
          return { kind: "granted", summary } as const;
        } catch (error) {
          return { error, kind: "rejected" } as const;
        }
      }),
    );
    const granted = outcomes.flatMap((outcome) =>
      outcome.kind === "granted" ? [outcome.summary] : [],
    );
    const rejected = outcomes.flatMap((outcome) =>
      outcome.kind === "rejected" ? [outcome.error] : [],
    );
    const recorded = await env.DB.prepare(
      `SELECT quantity,
        (SELECT COUNT(*) FROM credit_ledger WHERE owner_id = ?1) AS events
       FROM credit_ledger
       WHERE owner_id = ?1 AND reference_key = ?2`,
    )
      .bind(owner.ownerId, referenceKey)
      .first<{ events: number; quantity: number }>();

    expect(granted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(RepositoryConflictError);
    expect(recorded?.events).toBe(1);
    expect(granted[0]?.availableCredits).toBe(recorded?.quantity);

    const otherOwner = ownerContext("2");
    await upsertOwner(env.DB, otherOwner, now);
    await expect(
      grantPrivateBetaCredits(env.DB, {
        createdAt: now,
        eventId: createSecureId("evt"),
        ownerId: otherOwner.ownerId,
        quantity: 11,
        referenceKey,
      }),
    ).resolves.toMatchObject({ availableCredits: 11 });
    const ownerCounts = await env.DB.prepare(
      `SELECT COUNT(DISTINCT owner_id) AS owners, COUNT(*) AS events
       FROM credit_ledger
       WHERE reference_key = ?1`,
    )
      .bind(referenceKey)
      .first<{ events: number; owners: number }>();
    expect(ownerCounts).toEqual({ events: 2, owners: 2 });
  });

  it("does not reactivate a cancelled entitlement when an old grant is replayed", async () => {
    const owner = ownerContext("1");
    await upsertOwner(env.DB, owner, now);
    const grant = {
      createdAt: now,
      eventId: createSecureId("evt"),
      ownerId: owner.ownerId,
      quantity: 5,
      referenceKey: "test:grant:cancelled-replay",
    };
    await grantPrivateBetaCredits(env.DB, grant);
    await env.DB.prepare(
      "UPDATE owner_entitlements SET status = 'cancelled', updated_at = ?1 WHERE owner_id = ?2",
    )
      .bind(later, owner.ownerId)
      .run();
    await grantPrivateBetaCredits(env.DB, { ...grant, eventId: createSecureId("evt") });

    expect(await getOwnedCreditSummary(env.DB, owner.ownerId)).toMatchObject({
      availableCredits: 5,
      status: "cancelled",
    });
    const grants = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM credit_ledger WHERE owner_id = ?1 AND event_type = 'grant'",
    )
      .bind(owner.ownerId)
      .first<{ total: number }>();
    expect(grants?.total).toBe(1);
  });

  it("reports the newest owner-scoped entitlement or ledger activity", async () => {
    const owner = ownerContext("1");
    const otherOwner = ownerContext("2");
    const ledgerUpdate = "2026-07-24T05:30:00.000-05:00";
    const entitlementUpdate = "2026-07-24T11:00:00.000Z";
    await upsertOwner(env.DB, owner, now);
    await upsertOwner(env.DB, otherOwner, now);
    await grantPrivateBetaCredits(env.DB, {
      createdAt: now,
      eventId: createSecureId("evt"),
      ownerId: owner.ownerId,
      quantity: 5,
      referenceKey: "test:grant:summary-created",
    });
    await grantPrivateBetaCredits(env.DB, {
      createdAt: ledgerUpdate,
      eventId: createSecureId("evt"),
      ownerId: owner.ownerId,
      quantity: 2,
      referenceKey: "test:grant:summary-updated",
    });
    await grantPrivateBetaCredits(env.DB, {
      createdAt: later,
      eventId: createSecureId("evt"),
      ownerId: otherOwner.ownerId,
      quantity: 9,
      referenceKey: "test:grant:other-owner-summary",
    });

    await expect(getOwnedCreditSummary(env.DB, owner.ownerId)).resolves.toMatchObject({
      availableCredits: 7,
      updatedAt: ledgerUpdate,
    });

    await env.DB.prepare("UPDATE owner_entitlements SET updated_at = ?1 WHERE owner_id = ?2")
      .bind(entitlementUpdate, owner.ownerId)
      .run();
    await expect(getOwnedCreditSummary(env.DB, owner.ownerId)).resolves.toMatchObject({
      availableCredits: 7,
      updatedAt: entitlementUpdate,
    });
  });

  it("uses owner-bounded indexes for the credit summary", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT
         entitlements.plan_code,
         entitlements.status,
         entitlements.updated_at AS entitlement_updated_at,
         (
           SELECT ledger.created_at
           FROM credit_ledger AS ledger
           WHERE ledger.owner_id = entitlements.owner_id
           ORDER BY julianday(ledger.created_at) DESC, ledger.created_at DESC
           LIMIT 1
         ) AS ledger_updated_at,
         COALESCE(balances.available_credits, 0) AS available_credits,
         COALESCE(balances.reserved_credits, 0) AS reserved_credits,
         COALESCE(balances.settled_credits, 0) AS settled_credits
       FROM owner_entitlements AS entitlements
       LEFT JOIN (
         SELECT owner_id, available_credits, reserved_credits, settled_credits
         FROM credit_balances
         WHERE owner_id = ?1
       ) AS balances ON balances.owner_id = entitlements.owner_id
       WHERE entitlements.owner_id = ?1`,
    )
      .bind(ownerContext("1").ownerId)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect({
      fullLedgerScan: details.some((detail) => /^SCAN credit_ledger(?:\s|$)/.test(detail)),
      temporaryOrder: details.some((detail) => detail.includes("TEMP B-TREE FOR ORDER BY")),
      usesOwnerBalanceSearch: details.some(
        (detail) =>
          detail.includes("SEARCH credit_ledger USING") &&
          detail.includes("INDEX") &&
          detail.includes("owner_id=?"),
      ),
      usesOwnerInstantIndex: details.some((detail) =>
        detail.includes("USING COVERING INDEX idx_credit_ledger_owner_instant"),
      ),
    }).toEqual({
      fullLedgerScan: false,
      temporaryOrder: false,
      usesOwnerBalanceSearch: true,
      usesOwnerInstantIndex: true,
    });
  });

  it("settles or releases one reservation atomically with the terminal job state", async () => {
    const owner = ownerContext("1");
    const firstUploadId = await createConfirmedUpload(owner);
    const completedJob = await createJobIdempotently(env.DB, {
      createdAt: now,
      creditCost: 2,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-credit-settle",
      maxActiveJobs: 2,
      ownerId: owner.ownerId,
      presetId: "soft-piano",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "5".repeat(64),
      uploadId: firstUploadId,
    });
    await transitionOwnedJob(
      env.DB,
      owner.ownerId,
      completedJob.job.id,
      ["created"],
      "validating",
      { completedAt: null, errorCode: null, updatedAt: now },
    );
    await transitionOwnedJob(env.DB, owner.ownerId, completedJob.job.id, ["validating"], "queued", {
      completedAt: null,
      errorCode: null,
      updatedAt: now,
    });
    await transitionOwnedJob(env.DB, owner.ownerId, completedJob.job.id, ["queued"], "generating", {
      completedAt: null,
      errorCode: null,
      updatedAt: now,
    });
    await transitionOwnedJob(
      env.DB,
      owner.ownerId,
      completedJob.job.id,
      ["generating"],
      "processing_output",
      { completedAt: null, errorCode: null, updatedAt: now },
    );
    await completeOwnedJobWithCredits(env.DB, {
      eventId: createSecureId("evt"),
      jobId: completedJob.job.id,
      ownerId: owner.ownerId,
      timestamp: later,
    });
    await completeOwnedJobWithCredits(env.DB, {
      eventId: createSecureId("evt"),
      jobId: completedJob.job.id,
      ownerId: owner.ownerId,
      timestamp: later,
    });
    expect(await getOwnedCreditReservationStatus(env.DB, owner.ownerId, completedJob.job.id)).toBe(
      "settled",
    );

    const secondUploadId = await createConfirmedUpload(owner);
    const failedJob = await createJobIdempotently(env.DB, {
      createdAt: now,
      creditCost: 2,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-credit-release",
      maxActiveJobs: 2,
      ownerId: owner.ownerId,
      presetId: "music-box",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "4".repeat(64),
      uploadId: secondUploadId,
    });
    await transitionOwnedJob(env.DB, owner.ownerId, failedJob.job.id, ["created"], "validating", {
      completedAt: null,
      errorCode: null,
      updatedAt: now,
    });
    await failOwnedJobWithCreditRelease(env.DB, {
      errorCode: "MOCK_WORKFLOW_FAILED",
      eventId: createSecureId("evt"),
      jobId: failedJob.job.id,
      ownerId: owner.ownerId,
      timestamp: later,
    });
    await failOwnedJobWithCreditRelease(env.DB, {
      errorCode: "MOCK_WORKFLOW_FAILED",
      eventId: createSecureId("evt"),
      jobId: failedJob.job.id,
      ownerId: owner.ownerId,
      timestamp: later,
    });
    expect(await getOwnedCreditReservationStatus(env.DB, owner.ownerId, failedJob.job.id)).toBe(
      "released",
    );
    expect(await getOwnedCreditSummary(env.DB, owner.ownerId)).toMatchObject({
      availableCredits: 98,
      reservedCredits: 0,
      settledCredits: 2,
    });
  });

  it("converges competing completion and failure with one matching credit finalization", async () => {
    const owner = ownerContext("1");
    const otherOwner = ownerContext("2");
    const uploadId = await createConfirmedUpload(owner);
    const created = await createJobIdempotently(env.DB, {
      createdAt: now,
      creditCost: 2,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "job-request-competing-finalization",
      maxActiveJobs: 2,
      ownerId: owner.ownerId,
      presetId: "soft-piano",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "e".repeat(64),
      uploadId,
    });
    await transitionOwnedJob(env.DB, owner.ownerId, created.job.id, ["created"], "validating", {
      completedAt: null,
      errorCode: null,
      updatedAt: now,
    });
    await transitionOwnedJob(env.DB, owner.ownerId, created.job.id, ["validating"], "queued", {
      completedAt: null,
      errorCode: null,
      updatedAt: now,
    });
    await transitionOwnedJob(env.DB, owner.ownerId, created.job.id, ["queued"], "generating", {
      completedAt: null,
      errorCode: null,
      updatedAt: now,
    });
    await transitionOwnedJob(
      env.DB,
      owner.ownerId,
      created.job.id,
      ["generating"],
      "processing_output",
      { completedAt: null, errorCode: null, updatedAt: now },
    );

    await expect(
      completeOwnedJobWithCredits(env.DB, {
        eventId: createSecureId("evt"),
        jobId: created.job.id,
        ownerId: otherOwner.ownerId,
        timestamp: later,
      }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);

    const finalizations = [
      () =>
        completeOwnedJobWithCredits(env.DB, {
          eventId: createSecureId("evt"),
          jobId: created.job.id,
          ownerId: owner.ownerId,
          timestamp: later,
        }),
      () =>
        failOwnedJobWithCreditRelease(env.DB, {
          errorCode: "SYNTHETIC_TERMINAL_FAILURE",
          eventId: createSecureId("evt"),
          jobId: created.job.id,
          ownerId: owner.ownerId,
          timestamp: later,
        }),
    ];
    const outcomes = await Promise.all(
      finalizations.map(async (finalize) => {
        try {
          await finalize();
          return { kind: "fulfilled" } as const;
        } catch (error) {
          return { error, kind: "rejected" } as const;
        }
      }),
    );
    const fulfilled = outcomes.filter((outcome) => outcome.kind === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.kind === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toBeInstanceOf(RepositoryStateError);

    const terminalJob = await getOwnedJob(env.DB, owner.ownerId, created.job.id);
    if (terminalJob === null) {
      throw new Error("The competing finalization job was not found.");
    }
    const finalEvents = await env.DB.prepare(
      `SELECT event_type FROM credit_ledger
       WHERE owner_id = ?1
         AND job_id = ?2
         AND event_type IN ('settle', 'release')`,
    )
      .bind(owner.ownerId, created.job.id)
      .all<{ event_type: "release" | "settle" }>();
    expect(finalEvents.results).toHaveLength(1);
    const finalEvent = finalEvents.results[0]?.event_type;
    expect(finalEvent).toBe(terminalJob.status === "completed" ? "settle" : "release");
    expect(["completed", "failed"]).toContain(terminalJob.status);
    await expect(getOwnedCreditSummary(env.DB, owner.ownerId)).resolves.toMatchObject({
      availableCredits: finalEvent === "settle" ? 98 : 100,
      reservedCredits: 0,
      settledCredits: finalEvent === "settle" ? 2 : 0,
    });
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
        maxActiveJobs: 2,
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

  it("rejects an expired confirmed upload when creating a job", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    await env.DB.prepare("UPDATE uploads SET expires_at = ?1 WHERE id = ?2")
      .bind("2026-07-24T09:59:59.000Z", uploadId)
      .run();

    await expect(
      createJobIdempotently(env.DB, {
        createdAt: now,
        expiresAt: later,
        id: createSecureId("job"),
        idempotencyKey: "job-request-expired-upload",
        maxActiveJobs: 2,
        ownerId: owner.ownerId,
        presetId: "soft-piano",
        presetVersion: 1,
        provider: "mock",
        requestFingerprint: "8".repeat(64),
        uploadId,
      }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);

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
      maxActiveJobs: 2,
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

  it("enforces a rolling owner-scoped daily job limit", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const input = {
      createdAt: now,
      dailyWindowStartedAt: "2026-07-23T10:00:00.000Z",
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "daily-job-limit-0001",
      maxActiveJobs: 20,
      maxDailyJobs: 1,
      ownerId: owner.ownerId,
      presetId: "soft-piano" as const,
      presetVersion: 1,
      provider: "mock" as const,
      requestFingerprint: "6".repeat(64),
      uploadId,
    };
    const first = await createJobIdempotently(env.DB, input);
    const repeated = await createJobIdempotently(env.DB, {
      ...input,
      id: createSecureId("job"),
    });

    expect(repeated.created).toBe(false);
    expect(repeated.job.id).toBe(first.job.id);
    await expect(
      createJobIdempotently(env.DB, {
        ...input,
        id: createSecureId("job"),
        idempotencyKey: "daily-job-limit-0002",
        requestFingerprint: "5".repeat(64),
      }),
    ).rejects.toBeInstanceOf(RepositoryQuotaError);
  });

  it("uses the owner-active index for the active job quota", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT COUNT(*)
       FROM jobs
       WHERE owner_id = ?1
         AND status IN ('created', 'validating', 'queued', 'generating', 'processing_output')`,
    )
      .bind(ownerContext("1").ownerId)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect({
      fullJobsScan: details.some((detail) => /^SCAN jobs(?:\s|$)/.test(detail)),
      usesOwnerActiveIndex: details.some((detail) =>
        detail.includes("USING INDEX idx_jobs_owner_active"),
      ),
    }).toEqual({
      fullJobsScan: false,
      usesOwnerActiveIndex: true,
    });
  });

  it("uses owner-bounded indexes for the active upload quota", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT
         (
           SELECT COUNT(*) FROM uploads
           WHERE owner_id = ?1 AND status = 'pending' AND expires_at > ?2
         ) + (
           SELECT COUNT(*) FROM uploads
           WHERE owner_id = ?1 AND status = 'confirmed'
         ) AS total`,
    )
      .bind(ownerContext("1").ownerId, now)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect({
      fullUploadsScan: details.some((detail) => /^SCAN uploads(?:\s|$)/.test(detail)),
      usesConfirmedIndex: details.some((detail) =>
        detail.includes("USING COVERING INDEX idx_uploads_owner_confirmed_active"),
      ),
      usesPendingExpiryRange: details.some(
        (detail) =>
          detail.includes("USING COVERING INDEX idx_uploads_owner_pending_active") &&
          detail.includes("expires_at>?"),
      ),
    }).toEqual({
      fullUploadsScan: false,
      usesConfirmedIndex: true,
      usesPendingExpiryRange: true,
    });
  });

  it("atomically limits active jobs without blocking an idempotent retry", async () => {
    const owner = ownerContext("1");
    const firstUploadId = await createConfirmedUpload(owner);
    const secondUploadId = await createConfirmedUpload(owner);
    const firstInput = {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "active-job-limit-0001",
      maxActiveJobs: 1,
      ownerId: owner.ownerId,
      presetId: "soft-piano" as const,
      presetVersion: 1,
      provider: "mock" as const,
      requestFingerprint: "7".repeat(64),
      uploadId: firstUploadId,
    };
    const first = await createJobIdempotently(env.DB, firstInput);
    const repeated = await createJobIdempotently(env.DB, {
      ...firstInput,
      id: createSecureId("job"),
    });

    expect(repeated.created).toBe(false);
    expect(repeated.job.id).toBe(first.job.id);
    await expect(
      createJobIdempotently(env.DB, {
        ...firstInput,
        id: createSecureId("job"),
        idempotencyKey: "active-job-limit-0002",
        requestFingerprint: "8".repeat(64),
        uploadId: secondUploadId,
      }),
    ).rejects.toBeInstanceOf(RepositoryQuotaError);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM jobs").first<{
      total: number;
    }>();
    expect(count?.total).toBe(1);
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
      maxActiveJobs: 2,
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
        maxActiveJobs: 2,
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
      maxActiveJobs: 2,
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

  it("attaches one Workflow instance idempotently and rejects a different instance", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const created = await createJobIdempotently(env.DB, {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "workflow-attachment-0001",
      maxActiveJobs: 2,
      ownerId: owner.ownerId,
      presetId: "soft-piano",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "6".repeat(64),
      uploadId,
    });

    const attached = await attachOwnedJobWorkflow(
      env.DB,
      owner.ownerId,
      created.job.id,
      created.job.id,
    );
    const repeated = await attachOwnedJobWorkflow(
      env.DB,
      owner.ownerId,
      created.job.id,
      created.job.id,
    );
    expect(attached.workflowInstanceId).toBe(created.job.id);
    expect(repeated.workflowInstanceId).toBe(created.job.id);
    await expect(
      attachOwnedJobWorkflow(env.DB, owner.ownerId, created.job.id, "different-instance"),
    ).rejects.toBeInstanceOf(RepositoryConflictError);
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
      maxActiveJobs: 2,
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

  it("keeps candidate metadata and completion updates idempotent", async () => {
    const owner = ownerContext("1");
    const uploadId = await createConfirmedUpload(owner);
    const created = await createJobIdempotently(env.DB, {
      createdAt: now,
      expiresAt: later,
      id: createSecureId("job"),
      idempotencyKey: "generation-metadata-0001",
      maxActiveJobs: 2,
      ownerId: owner.ownerId,
      presetId: "music-box",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "5".repeat(64),
      uploadId,
    });
    const providerRequestId = `mock:${created.job.id}:0`;
    const firstProviderRequest = await createProviderRequest(env.DB, {
      candidateIndex: 0,
      id: createSecureId("req"),
      jobId: created.job.id,
      ownerId: owner.ownerId,
      provider: "mock",
    });
    const repeatedProviderRequest = await createProviderRequest(env.DB, {
      candidateIndex: 0,
      id: createSecureId("req"),
      jobId: created.job.id,
      ownerId: owner.ownerId,
      provider: "mock",
    });
    expect(repeatedProviderRequest.id).toBe(firstProviderRequest.id);

    const firstOutputId = createSecureId("out");
    const firstOutput = await createOutput(env.DB, {
      candidateIndex: 0,
      createdAt: now,
      expiresAt: later,
      id: firstOutputId,
      jobId: created.job.id,
      objectKey: `owners/${owner.ownerId}/outputs/${firstOutputId}/candidate`,
      ownerId: owner.ownerId,
    });
    const secondOutputId = createSecureId("out");
    const repeatedOutput = await createOutput(env.DB, {
      candidateIndex: 0,
      createdAt: now,
      expiresAt: later,
      id: secondOutputId,
      jobId: created.job.id,
      objectKey: `owners/${owner.ownerId}/outputs/${secondOutputId}/candidate`,
      ownerId: owner.ownerId,
    });
    expect(repeatedOutput.id).toBe(firstOutput.id);

    const submitted = {
      candidateIndex: 0 as const,
      jobId: created.job.id,
      ownerId: owner.ownerId,
      providerRequestId,
      submittedAt: now,
    };
    await markOwnedProviderRequestSubmitted(env.DB, submitted);
    await markOwnedProviderRequestSubmitted(env.DB, submitted);
    const completed = {
      candidateIndex: 0 as const,
      completedAt: later,
      jobId: created.job.id,
      ownerId: owner.ownerId,
      providerRequestId,
      seed: 42,
    };
    await expect(markOwnedProviderRequestCompleted(env.DB, completed)).resolves.toMatchObject({
      seed: 42,
    });
    await expect(markOwnedProviderRequestCompleted(env.DB, completed)).resolves.toMatchObject({
      seed: 42,
    });
    const ready = {
      candidateIndex: 0 as const,
      contentType: "audio/wav",
      durationSeconds: null,
      jobId: created.job.id,
      ownerId: owner.ownerId,
      sizeBytes: 16_044,
    };
    await markOwnedOutputReady(env.DB, ready);
    await markOwnedOutputReady(env.DB, ready);

    const rightsInput = {
      acceptedAt: now,
      declarationVersion: "v1",
      id: createSecureId("rgt"),
      jobId: created.job.id,
      ownerId: owner.ownerId,
      uploadId,
    };
    const rights = await recordRightsDeclaration(env.DB, rightsInput);
    const repeatedRights = await recordRightsDeclaration(env.DB, {
      ...rightsInput,
      id: createSecureId("rgt"),
    });
    expect(repeatedRights.id).toBe(rights.id);

    const usageInput = {
      createdAt: now,
      estimatedCostUsd: 0,
      eventType: "mock_generation_candidates",
      id: createSecureId("evt"),
      jobId: created.job.id,
      ownerId: owner.ownerId,
      quantity: 2,
    };
    const usage = await recordUsageEvent(env.DB, usageInput);
    const repeatedUsage = await recordUsageEvent(env.DB, usageInput);
    expect(repeatedUsage.id).toBe(usage.id);
    await expect(listOwnedOutputs(env.DB, owner.ownerId, created.job.id)).resolves.toMatchObject([
      { contentType: "audio/wav", id: firstOutput.id, status: "ready" },
    ]);
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
