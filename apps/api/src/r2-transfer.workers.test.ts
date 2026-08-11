import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { createSecureId } from "@studymix/core";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "./index";
import {
  confirmOwnedUpload,
  createJobIdempotently,
  createOutput,
  grantPrivateBetaCredits,
  recordCurrentLegalAcceptances,
  RepositoryNotFoundError,
} from "./repositories";
import { runRetentionCleanup } from "./retention";

type CreatedUpload = {
  expiresAt: string;
  idempotencyKey: string;
  objectKey: string;
  uploadId: string;
  uploadUrl: string;
};

const createdUploadEnvelopeSchema = z.object({
  data: z.object({
    expiresAt: z.string(),
    idempotencyKey: z.string(),
    objectKey: z.string(),
    uploadId: z.string(),
    uploadUrl: z.string(),
  }),
});
const confirmedUploadEnvelopeSchema = z.object({
  data: z.object({
    confirmedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    status: z.literal("confirmed"),
    uploadId: z.string(),
  }),
  error: z.null(),
});
const downloadEnvelopeSchema = z.object({ data: z.object({ downloadUrl: z.string() }) });
const browserMutationHeaders = {
  [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
} as const;
const jsonBrowserMutationHeaders = {
  ...browserMutationHeaders,
  "Content-Type": "application/json",
} as const;
let uploadRequestSequence = 0;

function nextUploadRequestKey(): string {
  uploadRequestSequence += 1;
  return `test-upload-request-${uploadRequestSequence.toString()}`;
}

const invalidUploadRequestCases = [
  {
    body: JSON.stringify({
      contentType: "audio/mpeg",
      idempotencyKey: "test-upload-invalid-media",
      originalFilename: "synthetic.mp3",
      sizeBytes: 4,
    }),
    contentType: "text/plain",
    expectedStatus: 415,
    label: "a non-JSON media type",
  },
  {
    body: "{",
    contentType: "application/json",
    expectedStatus: 400,
    label: "malformed JSON",
  },
  {
    body: JSON.stringify({ padding: "x".repeat(4_096) }),
    contentType: "application/json",
    expectedStatus: 413,
    label: "a JSON body over 4 KiB",
  },
  {
    body: JSON.stringify({
      contentType: "audio/mpeg",
      idempotencyKey: "test-upload-extra-field",
      originalFilename: "synthetic.mp3",
      sizeBytes: 4,
      unexpected: true,
    }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an extra metadata field",
  },
  {
    body: JSON.stringify({
      contentType: "audio/mpeg",
      idempotencyKey: "test-upload-control-name",
      originalFilename: "synthetic-input\u0000.mp3",
      sizeBytes: 4,
    }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "a filename control character",
  },
  {
    body: JSON.stringify({
      contentType: "audio/mpeg",
      idempotencyKey: "test-upload-empty-file",
      originalFilename: "synthetic.mp3",
      sizeBytes: 0,
    }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an empty file size",
  },
  {
    body: JSON.stringify({
      contentType: "audio/flac",
      idempotencyKey: "test-upload-unsupported-type",
      originalFilename: "synthetic.flac",
      sizeBytes: 4,
    }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an unsupported content type",
  },
  {
    body: JSON.stringify({
      contentType: "audio/mpeg",
      idempotencyKey: "test-upload-oversize",
      originalFilename: "synthetic.mp3",
      sizeBytes: 524_288_001,
    }),
    contentType: "application/json",
    expectedStatus: 413,
    label: "a size above the configured maximum",
  },
  {
    body: JSON.stringify({
      contentType: "audio/mpeg",
      originalFilename: "synthetic.mp3",
      sizeBytes: 4,
    }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "a missing idempotency key",
  },
] satisfies readonly Readonly<{
  body: string;
  contentType: string;
  expectedStatus: 400 | 413 | 415;
  label: string;
}>[];

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

async function requestUpload(
  environment: Env = env,
  overrides: Partial<{
    contentType: string;
    idempotencyKey: string;
    originalFilename: string;
    sizeBytes: number;
  }> = {},
): Promise<{ response: Response; upload: CreatedUpload }> {
  const response = await app.request(
    "http://localhost:8787/api/uploads",
    {
      body: JSON.stringify({
        contentType: "audio/mpeg",
        idempotencyKey: nextUploadRequestKey(),
        originalFilename: "fixture.mp3",
        sizeBytes: 4,
        ...overrides,
      }),
      headers: jsonBrowserMutationHeaders,
      method: "POST",
    },
    environment,
  );
  const body = createdUploadEnvelopeSchema.parse(await response.json());
  return { response, upload: body.data };
}

async function createReadyOutputFixture(): Promise<{ objectKey: string; outputId: string }> {
  const { upload } = await requestUpload();
  await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
    httpMetadata: { contentType: "audio/mpeg" },
  });
  await app.request(
    `http://localhost:8787/api/uploads/${upload.uploadId}/confirm`,
    { headers: browserMutationHeaders, method: "POST" },
    env,
  );
  const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
  if (owner === null) {
    throw new Error("Test owner was not created.");
  }
  await recordCurrentLegalAcceptances(env.DB, owner.id, new Date().toISOString());
  await grantPrivateBetaCredits(env.DB, {
    createdAt: new Date().toISOString(),
    eventId: createSecureId("evt"),
    ownerId: owner.id,
    quantity: 10,
    referenceKey: `test:download-grant:${owner.id}`,
  });
  const job = await createJobIdempotently(env.DB, {
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: createSecureId("job"),
    idempotencyKey: "output-download-test",
    maxActiveJobs: 2,
    ownerId: owner.id,
    presetId: "soft-piano",
    presetVersion: 1,
    provider: "mock",
    requestFingerprint: "a".repeat(64),
    uploadId: upload.uploadId,
  });
  const outputId = createSecureId("out");
  const objectKey = `owners/${owner.id}/outputs/${outputId}/candidate`;
  await createOutput(env.DB, {
    candidateIndex: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: outputId,
    jobId: job.job.id,
    objectKey,
    ownerId: owner.id,
  });
  await env.AUDIO_BUCKET.put(objectKey, new Uint8Array([5, 6, 7, 8]), {
    httpMetadata: { contentType: "audio/mpeg" },
  });
  await env.DB.prepare(
    "UPDATE outputs SET status = 'ready', content_type = 'audio/mpeg', size_bytes = 4 WHERE id = ?1",
  )
    .bind(outputId)
    .run();

  return { objectKey, outputId };
}

describe("private R2 transfer boundary", () => {
  beforeEach(async () => {
    uploadRequestSequence = 0;
    await resetDatabase();
  });

  it("returns a short-lived content-type-bound PUT URL without proxying audio", async () => {
    const { response, upload } = await requestUpload();
    const signedUrl = new URL(upload.uploadUrl);
    const row = await env.DB.prepare(
      `SELECT object_key, original_filename, size_bytes, status,
        idempotency_key, request_fingerprint
       FROM uploads WHERE id = ?1`,
    )
      .bind(upload.uploadId)
      .first<{
        object_key: string;
        idempotency_key: string;
        original_filename: string;
        request_fingerprint: string;
        size_bytes: number;
        status: string;
      }>();

    expect(response.status).toBe(201);
    expect(upload.objectKey).toMatch(
      /^owners\/own_[0-9a-f]{32}\/uploads\/upl_[0-9a-f]{32}\/source$/,
    );
    expect(upload.idempotencyKey).toBe("test-upload-request-1");
    expect(signedUrl.hostname).toBe("00000000000000000000000000000000.r2.cloudflarestorage.com");
    expect(signedUrl.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("if-none-match");
    expect(upload.uploadUrl).not.toContain(env.R2_S3_SECRET_ACCESS_KEY);
    expect(response.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
    expect(row).toEqual({
      object_key: upload.objectKey,
      idempotency_key: upload.idempotencyKey,
      original_filename: "fixture.mp3",
      request_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      size_bytes: 4,
      status: "pending",
    });
  });

  it("converges owner-scoped upload replays and rejects a different request", async () => {
    const idempotencyKey = "test-upload-concurrent-replay";
    const replays = await Promise.all([
      requestUpload(env, { idempotencyKey }),
      requestUpload(env, { idempotencyKey }),
    ]);
    expect(replays.map(({ response }) => response.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    expect(new Set(replays.map(({ upload }) => upload.uploadId)).size).toBe(1);
    expect(new Set(replays.map(({ upload }) => upload.uploadUrl)).size).toBe(1);

    const conflict = await app.request(
      "http://localhost:8787/api/uploads",
      {
        body: JSON.stringify({
          contentType: "audio/mpeg",
          idempotencyKey,
          originalFilename: "different.mp3",
          sizeBytes: 4,
        }),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      env,
    );
    const conflictBody: unknown = await conflict.json();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM uploads").first<{
      total: number;
    }>();

    expect(conflict.status).toBe(409);
    expect(conflictBody).toMatchObject({ error: { code: "CONFLICT", retryable: false } });
    expect(JSON.stringify(conflictBody)).not.toContain("different.mp3");
    expect(count?.total).toBe(1);

    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const otherOwner = await requestUpload(otherOwnerEnvironment, { idempotencyKey });
    expect(otherOwner.upload.uploadId).not.toBe(replays[0]?.upload.uploadId);
    const ownerCount = await env.DB.prepare(
      "SELECT COUNT(DISTINCT owner_id) AS owners, COUNT(*) AS uploads FROM uploads",
    ).first<{ owners: number; uploads: number }>();
    expect(ownerCount).toEqual({ owners: 2, uploads: 2 });
  });

  it.each([
    { expiresInMilliseconds: -1_000, status: "pending" },
    { expiresInMilliseconds: 60_000, status: "confirmed" },
    { expiresInMilliseconds: 60_000, status: "expired" },
    { expiresInMilliseconds: 60_000, status: "deleted" },
  ] as const)(
    "does not resurrect a $status upload through replay",
    async ({ expiresInMilliseconds, status }) => {
      const idempotencyKey = `test-upload-terminal-${status}`;
      const { upload } = await requestUpload(env, { idempotencyKey });
      await env.DB.prepare(
        "UPDATE uploads SET status = ?1, confirmed_at = ?2, expires_at = ?3 WHERE id = ?4",
      )
        .bind(
          status,
          status === "confirmed" ? new Date().toISOString() : null,
          new Date(Date.now() + expiresInMilliseconds).toISOString(),
          upload.uploadId,
        )
        .run();

      const replay = await app.request(
        "http://localhost:8787/api/uploads",
        {
          body: JSON.stringify({
            contentType: "audio/mpeg",
            idempotencyKey,
            originalFilename: "fixture.mp3",
            sizeBytes: 4,
          }),
          headers: jsonBrowserMutationHeaders,
          method: "POST",
        },
        env,
      );
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM uploads").first<{
        total: number;
      }>();

      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ error: { code: "CONFLICT", retryable: false } });
      expect(count?.total).toBe(1);
    },
  );

  it.each(invalidUploadRequestCases)(
    "rejects $label before creating private metadata",
    async ({ body, contentType, expectedStatus }) => {
      const response = await app.request(
        "http://localhost:8787/api/uploads",
        {
          body,
          headers: { ...browserMutationHeaders, "Content-Type": contentType },
          method: "POST",
        },
        env,
      );
      const responseBody: unknown = await response.json();
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM uploads").first<{
        total: number;
      }>();

      expect(response.status).toBe(expectedStatus);
      expect(responseBody).toMatchObject({
        data: null,
        error: { code: "VALIDATION_ERROR", retryable: false },
      });
      expect(JSON.stringify(responseBody)).not.toContain("synthetic-input");
      expect(count?.total).toBe(0);
    },
  );

  it("confirms only the owning upload after validating R2 size and content type", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}/confirm`,
      { headers: browserMutationHeaders, method: "POST" },
      otherOwnerEnvironment,
    );
    const confirmed = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}/confirm`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );

    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      data: {
        declaredContentType: "audio/mpeg",
        sizeBytes: 4,
        status: "confirmed",
        uploadId: upload.uploadId,
      },
      error: null,
    });
  });

  it("replays only a still-valid confirmation without another R2 read", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const confirmationUrl = `http://localhost:8787/api/uploads/${upload.uploadId}/confirm`;
    const firstResponse = await app.request(
      confirmationUrl,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const firstEnvelope = confirmedUploadEnvelopeSchema.parse(await firstResponse.json());
    let replayHeadRequestCount = 0;
    const noReplayHeadBucket = new Proxy(env.AUDIO_BUCKET, {
      get(target, property) {
        if (property === "head") {
          return async () => {
            replayHeadRequestCount += 1;
            throw new Error("A confirmed replay must not read R2 again.");
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    const replayEnvironment: Env = { ...env, AUDIO_BUCKET: noReplayHeadBucket };
    const validReplay = await app.request(
      confirmationUrl,
      { headers: browserMutationHeaders, method: "POST" },
      replayEnvironment,
    );
    const validEnvelope = confirmedUploadEnvelopeSchema.parse(await validReplay.json());
    await env.DB.prepare("UPDATE uploads SET expires_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 1_000).toISOString(), upload.uploadId)
      .run();
    const expiredReplay = await app.request(
      confirmationUrl,
      { headers: browserMutationHeaders, method: "POST" },
      replayEnvironment,
    );
    const expiredEnvelope: unknown = await expiredReplay.json();
    const row = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ status: string }>();

    expect(firstResponse.status).toBe(200);
    expect(validReplay.status).toBe(200);
    expect(validEnvelope.data).toEqual(firstEnvelope.data);
    expect(expiredReplay.status).toBe(409);
    expect(expiredEnvelope).toMatchObject({
      data: null,
      error: { code: "UPLOAD_EXPIRED", retryable: false },
    });
    expect(replayHeadRequestCount).toBe(0);
    expect(row?.status).toBe("confirmed");
  });

  it("converges simultaneous confirmations on the same owner-scoped upload", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    let headRequestCount = 0;
    let releaseHeadRequests: (() => void) | undefined;
    const bothHeadsStarted = new Promise<void>((resolve) => {
      releaseHeadRequests = resolve;
    });
    const gatedBucket = new Proxy(env.AUDIO_BUCKET, {
      get(target, property) {
        if (property === "head") {
          return async (key: string) => {
            headRequestCount += 1;
            if (headRequestCount === 2) {
              releaseHeadRequests?.();
            }
            await bothHeadsStarted;
            return await target.head(key);
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    const confirmationUrl = `http://localhost:8787/api/uploads/${upload.uploadId}/confirm`;
    const responses = await Promise.all([
      app.request(
        confirmationUrl,
        { headers: browserMutationHeaders, method: "POST" },
        { ...env, AUDIO_BUCKET: gatedBucket },
      ),
      app.request(
        confirmationUrl,
        { headers: browserMutationHeaders, method: "POST" },
        { ...env, AUDIO_BUCKET: gatedBucket },
      ),
    ]);
    const envelopes = await Promise.all(
      responses.map(async (response) => confirmedUploadEnvelopeSchema.parse(await response.json())),
    );
    const row = await env.DB.prepare(
      "SELECT confirmed_at, expires_at, owner_id, status FROM uploads WHERE id = ?1",
    )
      .bind(upload.uploadId)
      .first<{ confirmed_at: string; expires_at: string; owner_id: string; status: string }>();
    if (row === null) {
      throw new Error("The concurrently confirmed upload was not found.");
    }

    expect(headRequestCount).toBe(2);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(new Set(envelopes.map(({ data }) => data.uploadId))).toEqual(new Set([upload.uploadId]));
    expect(new Set(envelopes.map(({ data }) => data.confirmedAt)).size).toBe(1);
    expect(new Set(envelopes.map(({ data }) => data.expiresAt)).size).toBe(1);
    expect(row).toMatchObject({
      confirmed_at: envelopes[0]?.data.confirmedAt,
      expires_at: envelopes[0]?.data.expiresAt,
      status: "confirmed",
    });
    const replayedAt = new Date().toISOString();
    const replayRetentionExpiresAt = new Date(Date.now() + 60_000).toISOString();
    await expect(
      confirmOwnedUpload(
        env.DB,
        row.owner_id,
        upload.uploadId,
        5,
        replayedAt,
        replayRetentionExpiresAt,
      ),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(
      confirmOwnedUpload(
        env.DB,
        `own_${"f".repeat(32)}`,
        upload.uploadId,
        4,
        replayedAt,
        replayRetentionExpiresAt,
      ),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
  });

  it("rejects and removes an object that does not match declared metadata", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const response = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}/confirm`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const row = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ status: string }>();

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
    expect(row?.status).toBe("expired");
  });

  it("deletes only an owner-scoped upload and its one server-controlled object", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      otherOwnerEnvironment,
    );
    expect(denied.status).toBe(404);
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).not.toBeNull();

    const deleted = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      data: { status: "deleted", uploadId: upload.uploadId },
    });
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
    expect(
      await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
        .bind(upload.uploadId)
        .first<{ status: string }>(),
    ).toEqual({ status: "expired" });
  });

  it("removes a late signed PUT after its capability window closes", async () => {
    const { upload } = await requestUpload();
    const deleted = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );
    const row = await env.DB.prepare("SELECT created_at, status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ created_at: string; status: string }>();

    expect(deleted.status).toBe(200);
    expect(row?.status).toBe("expired");
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });

    const cleanup = await runRetentionCleanup(
      env,
      new Date(new Date(row?.created_at ?? 0).getTime() + 3_601_000),
    );
    const cleaned = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ status: string }>();

    expect(cleanup.deletedUnattachedUploads).toBe(1);
    expect(cleaned?.status).toBe("deleted");
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
  });

  it("leaves an interrupted owner deletion eligible for scheduled cleanup and replay", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
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
    const beforeFailure = Date.now();
    const failed = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      { ...env, AUDIO_BUCKET: failingBucket },
    );
    const claimed = await env.DB.prepare("SELECT expires_at, status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ expires_at: string; status: string }>();

    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      data: null,
      error: { code: "INTERNAL_ERROR", retryable: true },
    });
    expect(claimed?.status).toBe("expired");
    expect(new Date(claimed?.expires_at ?? 0).getTime()).toBeGreaterThanOrEqual(beforeFailure);
    expect(new Date(claimed?.expires_at ?? 0).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).not.toBeNull();

    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      otherOwnerEnvironment,
    );
    expect(denied.status).toBe(404);
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).not.toBeNull();

    const cleanup = await runRetentionCleanup(env, new Date(Date.now() + 3_601_000));
    const cleaned = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ status: string }>();
    expect(cleanup.deletedUnattachedUploads).toBe(1);
    expect(cleaned?.status).toBe("deleted");
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();

    const replayed = await app.request(
      `http://localhost:8787/api/uploads/${upload.uploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      env,
    );
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toMatchObject({
      data: { status: "deleted", uploadId: upload.uploadId },
    });
  });

  it("keeps simultaneous owner deletion replays idempotent", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.request(
          `http://localhost:8787/api/uploads/${upload.uploadId}`,
          { headers: browserMutationHeaders, method: "DELETE" },
          env,
        ),
      ),
    );
    const row = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ status: string }>();

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(row?.status).toBe("expired");
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
  });

  it("signs a ready output download only for the owning user", async () => {
    const { outputId } = await createReadyOutputFixture();

    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `http://localhost:8787/api/outputs/${outputId}/download`,
      { headers: browserMutationHeaders, method: "POST" },
      otherOwnerEnvironment,
    );
    const response = await app.request(
      `http://localhost:8787/api/outputs/${outputId}/download`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const body = downloadEnvelopeSchema.parse(await response.json());

    expect(denied.status).toBe(404);
    expect(response.status).toBe(200);
    expect(new URL(body.data.downloadUrl).searchParams.get("X-Amz-Expires")).toBe("60");
    expect(new URL(body.data.downloadUrl).searchParams.get("X-Amz-SignedHeaders")).not.toContain(
      "content-type",
    );
    expect(body.data.downloadUrl).not.toContain(env.R2_S3_SECRET_ACCESS_KEY);
  });

  it("does not sign a pending output", async () => {
    const { outputId } = await createReadyOutputFixture();
    await env.DB.prepare("UPDATE outputs SET status = 'pending' WHERE id = ?1")
      .bind(outputId)
      .run();

    const response = await app.request(
      `http://localhost:8787/api/outputs/${outputId}/download`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      data: null,
      error: { code: "OUTPUT_NOT_READY", retryable: true },
    });
    expect(JSON.stringify(body)).not.toContain("downloadUrl");
  });

  it("does not sign an expired output", async () => {
    const { outputId } = await createReadyOutputFixture();
    await env.DB.prepare("UPDATE outputs SET expires_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 1_000).toISOString(), outputId)
      .run();

    const response = await app.request(
      `http://localhost:8787/api/outputs/${outputId}/download`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      data: null,
      error: { code: "OUTPUT_EXPIRED", retryable: false },
    });
    expect(JSON.stringify(body)).not.toContain("downloadUrl");
  });

  it("does not sign an output beyond its remaining retention lifetime", async () => {
    const { outputId } = await createReadyOutputFixture();
    const outputExpiresAt = new Date(Date.now() + 10_000).toISOString();
    await env.DB.prepare("UPDATE outputs SET expires_at = ?1 WHERE id = ?2")
      .bind(outputExpiresAt, outputId)
      .run();

    const response = await app.request(
      `http://localhost:8787/api/outputs/${outputId}/download`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const body = downloadEnvelopeSchema.parse(await response.json());
    const signedLifetime = Number(new URL(body.data.downloadUrl).searchParams.get("X-Amz-Expires"));

    expect(response.status).toBe(200);
    expect(signedLifetime).toBeGreaterThanOrEqual(1);
    expect(signedLifetime).toBeLessThanOrEqual(10);
  });

  it.each([
    {
      bytes: new Uint8Array([5, 6, 7]),
      contentType: "audio/mpeg",
      label: "size",
    },
    {
      bytes: new Uint8Array([5, 6, 7, 8]),
      contentType: "audio/wav",
      label: "content type",
    },
  ])("does not sign an output with mismatched R2 $label", async ({ bytes, contentType }) => {
    const { objectKey, outputId } = await createReadyOutputFixture();
    await env.AUDIO_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType } });

    const response = await app.request(
      `http://localhost:8787/api/outputs/${outputId}/download`,
      { headers: browserMutationHeaders, method: "POST" },
      env,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      data: null,
      error: { code: "INTERNAL_ERROR", retryable: true },
    });
    expect(JSON.stringify(body)).not.toContain("downloadUrl");
  });

  it("fails closed before creating metadata when signed transfer is disabled", async () => {
    const disabledEnvironment: Env = { ...env, R2_TRANSFER_ENABLED: "false" };
    const response = await app.request(
      "http://localhost:8787/api/uploads",
      {
        body: JSON.stringify({
          contentType: "audio/mpeg",
          idempotencyKey: "test-upload-disabled-transfer",
          originalFilename: "fixture.mp3",
          sizeBytes: 4,
        }),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      disabledEnvironment,
    );
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM uploads").first<{
      total: number;
    }>();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(count?.total).toBe(0);
  });

  it("atomically limits simultaneous active uploads before returning signed URLs", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.request(
          "http://localhost:8787/api/uploads",
          {
            body: JSON.stringify({
              contentType: "audio/mpeg",
              idempotencyKey: `test-upload-quota-${index.toString()}`,
              originalFilename: `fixture-${index.toString()}.mp3`,
              sizeBytes: 4,
            }),
            headers: jsonBrowserMutationHeaders,
            method: "POST",
          },
          env,
        ),
      ),
    );
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM uploads").first<{
      total: number;
    }>();

    expect(responses.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
      201, 201, 201, 429,
    ]);
    const rejected = responses.find(({ status }) => status === 429);
    if (rejected === undefined) {
      throw new Error("The simultaneous upload quota did not reject one request.");
    }
    expect(await rejected.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(count?.total).toBe(3);
  });
});
