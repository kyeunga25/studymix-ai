import {
  apiEnvelopeSchema,
  createUploadResponseSchema,
  currentRightsDeclarationVersion,
  deleteJobResponseSchema,
  publicJobSchema,
} from "@studymix/contracts";
import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { createSecureId } from "@studymix/core";
import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "./index";
import { grantPrivateBetaCredits, recordCurrentLegalAcceptances } from "./repositories";
import { runRetentionCleanup } from "./retention";

const uploadEnvelopeSchema = apiEnvelopeSchema(createUploadResponseSchema);
const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const deleteJobEnvelopeSchema = apiEnvelopeSchema(deleteJobResponseSchema);
const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string() }) });
const browserMutationHeaders = {
  [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
} as const;
const jsonBrowserMutationHeaders = {
  ...browserMutationHeaders,
  "Content-Type": "application/json",
} as const;

async function resetStorage(): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.AUDIO_BUCKET.list({ ...(cursor === undefined ? {} : { cursor }) });
    if (listed.objects.length > 0) {
      await env.AUDIO_BUCKET.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
}

async function resetDatabase(): Promise<void> {
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
}

async function createConfirmedUpload(): Promise<{
  objectKey: string;
  ownerId: string;
  uploadId: string;
}> {
  const response = await app.request(
    "http://localhost:8787/api/uploads",
    {
      body: JSON.stringify({
        contentType: "audio/mpeg",
        idempotencyKey: "test-upload-retention-fixture",
        originalFilename: "retention-fixture.mp3",
        sizeBytes: 4,
      }),
      headers: jsonBrowserMutationHeaders,
      method: "POST",
    },
    env,
  );
  const envelope = uploadEnvelopeSchema.parse(await response.json());
  if (envelope.error !== null) {
    throw new Error("Retention test upload could not be created.");
  }
  await env.AUDIO_BUCKET.put(envelope.data.objectKey, new Uint8Array([1, 2, 3, 4]), {
    httpMetadata: { contentType: "audio/mpeg" },
  });
  const confirmation = await app.request(
    `http://localhost:8787/api/uploads/${envelope.data.uploadId}/confirm`,
    { headers: browserMutationHeaders, method: "POST" },
    env,
  );
  expect(confirmation.status).toBe(200);
  const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
  if (owner === null) {
    throw new Error("Retention test owner was not created.");
  }
  await grantPrivateBetaCredits(env.DB, {
    createdAt: new Date().toISOString(),
    eventId: createSecureId("evt"),
    ownerId: owner.id,
    quantity: 20,
    referenceKey: `test:retention-grant:${owner.id}`,
  });
  return {
    objectKey: envelope.data.objectKey,
    ownerId: owner.id,
    uploadId: envelope.data.uploadId,
  };
}

async function createCompletedJob(): Promise<{
  jobId: string;
  outputKeys: readonly string[];
  ownerId: string;
  sourceKey: string;
  uploadId: string;
}> {
  const upload = await createConfirmedUpload();
  await recordCurrentLegalAcceptances(env.DB, upload.ownerId, new Date().toISOString());
  const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
  try {
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
    });
    const response = await app.request(
      "http://localhost:8787/api/jobs",
      {
        body: JSON.stringify({
          candidateCount: 2,
          idempotencyKey: "retention-test-request-0001",
          presetId: "soft-piano",
          presetVersion: 1,
          rightsDeclarationVersion: currentRightsDeclarationVersion,
          uploadId: upload.uploadId,
        }),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      env,
    );
    const envelope = jobEnvelopeSchema.parse(await response.json());
    if (envelope.error !== null) {
      throw new Error("Retention test job could not be created.");
    }
    const instances = await introspector.get();
    const instance = instances[0];
    if (instance === undefined) {
      throw new Error("Retention test Workflow was not created.");
    }
    await instance.waitForStatus("complete");
    const outputs = await env.DB.prepare(
      "SELECT object_key FROM outputs WHERE job_id = ?1 ORDER BY candidate_index",
    )
      .bind(envelope.data.jobId)
      .all<{ object_key: string }>();
    return {
      jobId: envelope.data.jobId,
      outputKeys: outputs.results.map((output) => output.object_key),
      ownerId: upload.ownerId,
      sourceKey: upload.objectKey,
      uploadId: upload.uploadId,
    };
  } finally {
    await introspector.dispose();
  }
}

async function insertSharedJob(
  ownerId: string,
  uploadId: string,
  input: Readonly<{
    completedAt: string | null;
    status: "completed" | "generating";
    updatedAt: string;
  }>,
): Promise<string> {
  const sharedJobId = createSecureId("job");
  await env.DB.prepare(
    `INSERT INTO jobs (
       id, owner_id, upload_id, preset_id, preset_version, status,
       idempotency_key, request_fingerprint, workflow_instance_id,
       candidate_count, provider, error_code, created_at, updated_at,
       completed_at, expires_at
     ) VALUES (
       ?1, ?2, ?3, 'soft-piano', 1, ?4,
       ?5, ?6, ?1, 2, 'mock', NULL, ?7, ?7, ?8, ?9
     )`,
  )
    .bind(
      sharedJobId,
      ownerId,
      uploadId,
      input.status,
      `shared-${sharedJobId}`,
      "c".repeat(64),
      input.updatedAt,
      input.completedAt,
      "2026-08-02T00:00:00.000Z",
    )
    .run();
  return sharedJobId;
}

describe("private retention and deletion", () => {
  beforeEach(async () => {
    await resetStorage();
    await resetDatabase();
  });

  it("uses bounded indexes for unattached upload retention candidates", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT uploads.id
       FROM uploads
       WHERE (
           (uploads.status = 'pending' AND uploads.created_at <= ?1)
           OR (
             uploads.status IN ('confirmed', 'expired')
             AND uploads.expires_at <= ?2
           )
         )
         AND uploads.created_at <= ?3
         AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.upload_id = uploads.id)
       ORDER BY uploads.created_at, uploads.id
       LIMIT ?4`,
    )
      .bind("2026-07-25T12:00:00.000Z", "2026-07-26T12:00:00.000Z", "2026-07-26T11:00:00.000Z", 50)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect({
      fullTableScan: details.some((detail) => /^SCAN (?:jobs|uploads)(?:\s|$)/.test(detail)),
      usesJobUploadIndex: details.some((detail) => detail.includes("idx_jobs_upload_id")),
      usesPendingUploadIndex: details.some((detail) =>
        detail.includes("idx_uploads_pending_created_id"),
      ),
      usesStoredUploadIndex: details.some((detail) =>
        detail.includes("idx_uploads_stored_expires_id"),
      ),
    }).toEqual({
      fullTableScan: false,
      usesJobUploadIndex: true,
      usesPendingUploadIndex: true,
      usesStoredUploadIndex: true,
    });
  });

  it("uses a bounded index for completed source retention candidates", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT uploads.id
       FROM uploads
       INNER JOIN jobs ON jobs.upload_id = uploads.id
       WHERE jobs.status = 'completed'
         AND jobs.completed_at IS NOT NULL
         AND jobs.completed_at <= ?1
         AND uploads.status IN ('confirmed', 'expired')
         AND NOT EXISTS (
           SELECT 1 FROM jobs AS retaining_jobs
           WHERE retaining_jobs.upload_id = uploads.id
             AND retaining_jobs.id <> jobs.id
             AND (
               retaining_jobs.status NOT IN ('completed', 'expired')
               OR (
                 retaining_jobs.status = 'completed'
                 AND (
                   retaining_jobs.completed_at IS NULL
                   OR retaining_jobs.completed_at > ?1
                 )
               )
             )
         )
       ORDER BY jobs.completed_at, uploads.id
       LIMIT ?2`,
    )
      .bind("2026-07-25T12:00:00.000Z", 50)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect({
      fullJobsScan: details.some((detail) => /^SCAN jobs(?:\s|$)/.test(detail)),
      usesCompletedSourceIndex: details.some((detail) =>
        detail.includes("idx_jobs_completed_source_cutoff"),
      ),
    }).toEqual({
      fullJobsScan: false,
      usesCompletedSourceIndex: true,
    });
  });

  it("uses bounded cutoff indexes for terminal job retention candidates", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT jobs.id, jobs.owner_id
       FROM jobs
       WHERE (
         (jobs.status = 'completed' AND jobs.expires_at <= ?1)
         OR (
           jobs.status IN ('failed', 'cancelled')
           AND jobs.completed_at IS NOT NULL
           AND jobs.completed_at <= ?2
         )
         OR jobs.status = 'expired'
       )
       AND (
         jobs.status <> 'expired'
         OR
         EXISTS (
           SELECT 1 FROM uploads
           WHERE uploads.id = jobs.upload_id
             AND uploads.status <> 'deleted'
             AND NOT EXISTS (
               SELECT 1 FROM jobs AS retaining_jobs
               WHERE retaining_jobs.upload_id = uploads.id
                 AND retaining_jobs.id <> jobs.id
                 AND retaining_jobs.status <> 'expired'
             )
         )
         OR EXISTS (
           SELECT 1 FROM outputs
           WHERE outputs.job_id = jobs.id AND outputs.status <> 'deleted'
         )
       )
       ORDER BY jobs.updated_at, jobs.id
       LIMIT ?3`,
    )
      .bind("2026-07-26T12:00:00.000Z", "2026-07-25T12:00:00.000Z", 50)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect({
      fullRetentionTableScan: details.some((detail) =>
        /^SCAN (?:jobs|outputs|uploads)(?:\s|$)/.test(detail),
      ),
      usesCompletedExpiryRange: details.some(
        (detail) =>
          detail.includes("idx_jobs_completed_expiry_cutoff") && detail.includes("expires_at"),
      ),
      usesExpiredStatusIndex: details.some((detail) =>
        detail.includes("idx_jobs_status (status=?"),
      ),
      usesFailedCompletedRange: details.some(
        (detail) =>
          detail.includes("idx_jobs_failed_completed_cutoff") && detail.includes("completed_at"),
      ),
    }).toEqual({
      fullRetentionTableScan: false,
      usesCompletedExpiryRange: true,
      usesExpiredStatusIndex: true,
      usesFailedCompletedRange: true,
    });
  });

  it("lets only the owner purge a terminal job and remains idempotent", async () => {
    const fixture = await createCompletedJob();
    const denied = await app.request(
      `http://localhost:8787/api/jobs/${fixture.jobId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      { ...env, DEV_AUTH_SUBJECT: "another-retention-owner" },
    );
    expect(denied.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await denied.json()).error.code).toBe("NOT_FOUND");

    const response = await app.request(
      `http://localhost:8787/api/jobs/${fixture.jobId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );
    const envelope = deleteJobEnvelopeSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(envelope.error).toBeNull();
    expect(await env.AUDIO_BUCKET.head(fixture.sourceKey)).toBeNull();
    for (const outputKey of fixture.outputKeys) {
      expect(await env.AUDIO_BUCKET.head(outputKey)).toBeNull();
    }

    const statuses = await env.DB.prepare(
      `SELECT
        (SELECT status FROM jobs WHERE id = ?1) AS job_status,
        (SELECT status FROM uploads WHERE id = ?2) AS upload_status,
        (SELECT COUNT(*) FROM outputs WHERE job_id = ?1 AND status = 'deleted') AS deleted_outputs`,
    )
      .bind(fixture.jobId, fixture.uploadId)
      .first<{ deleted_outputs: number; job_status: string; upload_status: string }>();
    expect(statuses).toEqual({
      deleted_outputs: 2,
      job_status: "expired",
      upload_status: "expired",
    });

    const repeated = await app.request(
      `http://localhost:8787/api/jobs/${fixture.jobId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );
    expect(repeated.status).toBe(200);
    expect(deleteJobEnvelopeSchema.parse(await repeated.json()).error).toBeNull();
  });

  it("preserves a shared source until every referencing job is terminal", async () => {
    const fixture = await createCompletedJob();
    const sharedJobId = await insertSharedJob(fixture.ownerId, fixture.uploadId, {
      completedAt: null,
      status: "generating",
      updatedAt: new Date().toISOString(),
    });

    const firstDeletion = await app.request(
      `http://localhost:8787/api/jobs/${fixture.jobId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );
    const preserved = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(fixture.uploadId)
      .first<{ status: string }>();

    expect(firstDeletion.status).toBe(200);
    expect(preserved?.status).toBe("confirmed");
    expect(await env.AUDIO_BUCKET.head(fixture.sourceKey)).not.toBeNull();

    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE jobs SET status = 'completed', completed_at = ?1, updated_at = ?1 WHERE id = ?2",
    )
      .bind(completedAt, sharedJobId)
      .run();
    const finalDeletion = await app.request(
      `http://localhost:8787/api/jobs/${sharedJobId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );

    expect(finalDeletion.status).toBe(200);
    expect(await env.AUDIO_BUCKET.head(fixture.sourceKey)).toBeNull();
  });

  it("does not run completed-source retention while a newer shared job needs the upload", async () => {
    const fixture = await createCompletedJob();
    const newerJobId = await insertSharedJob(fixture.ownerId, fixture.uploadId, {
      completedAt: "2026-07-26T11:30:00.000Z",
      status: "completed",
      updatedAt: "2026-07-26T11:30:00.000Z",
    });
    await env.DB.prepare(
      "UPDATE jobs SET completed_at = ?1, expires_at = ?2, updated_at = ?1 WHERE id = ?3",
    )
      .bind("2026-07-23T11:00:00.000Z", "2026-07-27T12:00:00.000Z", fixture.jobId)
      .run();
    await env.DB.prepare("UPDATE jobs SET expires_at = ?1 WHERE id = ?2")
      .bind("2026-07-27T12:00:00.000Z", newerJobId)
      .run();
    await env.DB.prepare("UPDATE uploads SET created_at = ?1 WHERE id = ?2")
      .bind("2026-07-23T10:00:00.000Z", fixture.uploadId)
      .run();

    const now = new Date("2026-07-26T12:00:00.000Z");
    const preserved = await runRetentionCleanup(env, now);
    expect(preserved.deletedSources).toBe(0);
    expect(await env.AUDIO_BUCKET.head(fixture.sourceKey)).not.toBeNull();

    await env.DB.prepare("UPDATE jobs SET completed_at = ?1, updated_at = ?1 WHERE id = ?2")
      .bind("2026-07-23T11:30:00.000Z", newerJobId)
      .run();
    const purged = await runRetentionCleanup(env, now);
    expect(purged.deletedSources).toBe(1);
    expect(await env.AUDIO_BUCKET.head(fixture.sourceKey)).toBeNull();
  });

  it("deletes completed sources first and expires outputs at the final deadline", async () => {
    const fixture = await createCompletedJob();
    const now = new Date("2026-07-26T12:00:00.000Z");
    await env.DB.prepare(
      "UPDATE jobs SET completed_at = ?1, expires_at = ?2, updated_at = ?1 WHERE id = ?3",
    )
      .bind("2026-07-23T11:00:00.000Z", "2026-07-27T12:00:00.000Z", fixture.jobId)
      .run();
    await env.DB.prepare("UPDATE uploads SET created_at = ?1 WHERE id = ?2")
      .bind("2026-07-23T10:00:00.000Z", fixture.uploadId)
      .run();

    const sourceCleanup = await runRetentionCleanup(env, now);
    expect(sourceCleanup).toMatchObject({
      deletedJobs: 0,
      deletedSources: 1,
      deletedUnattachedUploads: 0,
      skipped: false,
    });
    expect(await env.AUDIO_BUCKET.head(fixture.sourceKey)).toBeNull();
    for (const outputKey of fixture.outputKeys) {
      expect(await env.AUDIO_BUCKET.head(outputKey)).not.toBeNull();
    }

    await env.DB.prepare("UPDATE jobs SET expires_at = ?1 WHERE id = ?2")
      .bind("2026-07-26T11:59:59.000Z", fixture.jobId)
      .run();

    const deletionFailure = new Error("Simulated R2 deletion failure.");
    const failingBucket = new Proxy(env.AUDIO_BUCKET, {
      get(target, property) {
        if (property === "delete") {
          return async () => {
            throw deletionFailure;
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    await expect(runRetentionCleanup({ ...env, AUDIO_BUCKET: failingBucket }, now)).rejects.toThrow(
      deletionFailure,
    );
    expect(
      await env.DB.prepare("SELECT status FROM jobs WHERE id = ?1")
        .bind(fixture.jobId)
        .first<{ status: string }>(),
    ).toEqual({ status: "expired" });
    for (const outputKey of fixture.outputKeys) {
      expect(await env.AUDIO_BUCKET.head(outputKey)).not.toBeNull();
    }

    const outputCleanup = await runRetentionCleanup(env, now);
    expect(outputCleanup.deletedJobs).toBe(1);
    expect(outputCleanup.deletedObjects).toBe(2);
    for (const outputKey of fixture.outputKeys) {
      expect(await env.AUDIO_BUCKET.head(outputKey)).toBeNull();
    }
    expect(await runRetentionCleanup(env, now)).toMatchObject({
      deletedJobs: 0,
      deletedObjects: 0,
    });
  });

  it("purges unattached uploads after the configured window and skips when disabled", async () => {
    const upload = await createConfirmedUpload();
    await env.DB.prepare("UPDATE uploads SET created_at = ?1, expires_at = ?2 WHERE id = ?3")
      .bind("2026-07-25T11:00:00.000Z", "2026-07-26T11:00:00.000Z", upload.uploadId)
      .run();
    const result = await runRetentionCleanup(env, new Date("2026-07-26T12:00:00.000Z"));
    expect(result.deletedUnattachedUploads).toBe(1);
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();

    await expect(
      runRetentionCleanup(
        { ...env, RETENTION_CLEANUP_ENABLED: "false" },
        new Date("2026-07-26T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ skipped: true });
  });
});
