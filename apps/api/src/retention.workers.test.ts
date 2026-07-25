import {
  apiEnvelopeSchema,
  createUploadResponseSchema,
  currentRightsDeclarationVersion,
  deleteJobResponseSchema,
  publicJobSchema,
} from "@studymix/contracts";
import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "./index";
import { recordCurrentLegalAcceptances } from "./repositories";
import { runRetentionCleanup } from "./retention";

const uploadEnvelopeSchema = apiEnvelopeSchema(createUploadResponseSchema);
const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const deleteJobEnvelopeSchema = apiEnvelopeSchema(deleteJobResponseSchema);
const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string() }) });

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
  await env.DB.prepare("DELETE FROM usage_events").run();
  await env.DB.prepare("DELETE FROM rights_declarations").run();
  await env.DB.prepare("DELETE FROM outputs").run();
  await env.DB.prepare("DELETE FROM provider_requests").run();
  await env.DB.prepare("DELETE FROM jobs").run();
  await env.DB.prepare("DELETE FROM uploads").run();
  await env.DB.prepare("DELETE FROM owners").run();
}

async function createConfirmedUpload(): Promise<{
  objectKey: string;
  ownerId: string;
  uploadId: string;
}> {
  const response = await app.request(
    "https://studymix.example/api/uploads",
    {
      body: JSON.stringify({
        contentType: "audio/mpeg",
        originalFilename: "retention-fixture.mp3",
        sizeBytes: 4,
      }),
      headers: { "Content-Type": "application/json" },
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
    `https://studymix.example/api/uploads/${envelope.data.uploadId}/confirm`,
    { method: "POST" },
    env,
  );
  expect(confirmation.status).toBe(200);
  const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
  if (owner === null) {
    throw new Error("Retention test owner was not created.");
  }
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
      "https://studymix.example/api/jobs",
      {
        body: JSON.stringify({
          candidateCount: 2,
          idempotencyKey: "retention-test-request-0001",
          presetId: "soft-piano",
          presetVersion: 1,
          rightsDeclarationVersion: currentRightsDeclarationVersion,
          uploadId: upload.uploadId,
        }),
        headers: { "Content-Type": "application/json" },
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

describe("private retention and deletion", () => {
  beforeEach(async () => {
    await resetStorage();
    await resetDatabase();
  });

  it("lets only the owner purge a terminal job and remains idempotent", async () => {
    const fixture = await createCompletedJob();
    const denied = await app.request(
      `https://studymix.example/api/jobs/${fixture.jobId}`,
      { method: "DELETE" },
      { ...env, DEV_AUTH_SUBJECT: "another-retention-owner" },
    );
    expect(denied.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await denied.json()).error.code).toBe("NOT_FOUND");

    const response = await app.request(
      `https://studymix.example/api/jobs/${fixture.jobId}`,
      { method: "DELETE" },
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
      upload_status: "deleted",
    });

    const repeated = await app.request(
      `https://studymix.example/api/jobs/${fixture.jobId}`,
      { method: "DELETE" },
      env,
    );
    expect(repeated.status).toBe(200);
    expect(deleteJobEnvelopeSchema.parse(await repeated.json()).error).toBeNull();
  });

  it("deletes completed sources first and expires outputs at the final deadline", async () => {
    const fixture = await createCompletedJob();
    const now = new Date("2026-07-26T12:00:00.000Z");
    await env.DB.prepare(
      "UPDATE jobs SET completed_at = ?1, expires_at = ?2, updated_at = ?1 WHERE id = ?3",
    )
      .bind("2026-07-23T11:00:00.000Z", "2026-07-27T12:00:00.000Z", fixture.jobId)
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
