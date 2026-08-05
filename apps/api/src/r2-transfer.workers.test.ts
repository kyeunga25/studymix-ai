import { createSecureId } from "@studymix/core";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "./index";
import {
  createJobIdempotently,
  createOutput,
  grantPrivateBetaCredits,
  recordCurrentLegalAcceptances,
} from "./repositories";

type CreatedUpload = {
  expiresAt: string;
  objectKey: string;
  uploadId: string;
  uploadUrl: string;
};

const createdUploadEnvelopeSchema = z.object({
  data: z.object({
    expiresAt: z.string(),
    objectKey: z.string(),
    uploadId: z.string(),
    uploadUrl: z.string(),
  }),
});
const downloadEnvelopeSchema = z.object({ data: z.object({ downloadUrl: z.string() }) });

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
  await env.DB.prepare("DELETE FROM owners").run();
}

async function requestUpload(
  environment: Env = env,
  overrides: Partial<{ contentType: string; originalFilename: string; sizeBytes: number }> = {},
): Promise<{ response: Response; upload: CreatedUpload }> {
  const response = await app.request(
    "https://studymix.example/api/uploads",
    {
      body: JSON.stringify({
        contentType: "audio/mpeg",
        originalFilename: "fixture.mp3",
        sizeBytes: 4,
        ...overrides,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    environment,
  );
  const body = createdUploadEnvelopeSchema.parse(await response.json());
  return { response, upload: body.data };
}

describe("private R2 transfer boundary", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns a short-lived content-type-bound PUT URL without proxying audio", async () => {
    const { response, upload } = await requestUpload();
    const signedUrl = new URL(upload.uploadUrl);
    const row = await env.DB.prepare(
      "SELECT object_key, original_filename, size_bytes, status FROM uploads WHERE id = ?1",
    )
      .bind(upload.uploadId)
      .first<{
        object_key: string;
        original_filename: string;
        size_bytes: number;
        status: string;
      }>();

    expect(response.status).toBe(201);
    expect(upload.objectKey).toMatch(
      /^owners\/own_[0-9a-f]{32}\/uploads\/upl_[0-9a-f]{32}\/source$/,
    );
    expect(signedUrl.hostname).toBe("00000000000000000000000000000000.r2.cloudflarestorage.com");
    expect(signedUrl.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("if-none-match");
    expect(upload.uploadUrl).not.toContain(env.R2_S3_SECRET_ACCESS_KEY);
    expect(response.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
    expect(row).toEqual({
      object_key: upload.objectKey,
      original_filename: "fixture.mp3",
      size_bytes: 4,
      status: "pending",
    });
  });

  it("confirms only the owning upload after validating R2 size and content type", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `https://studymix.example/api/uploads/${upload.uploadId}/confirm`,
      { method: "POST" },
      otherOwnerEnvironment,
    );
    const confirmed = await app.request(
      `https://studymix.example/api/uploads/${upload.uploadId}/confirm`,
      { method: "POST" },
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

  it("rejects and removes an object that does not match declared metadata", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const response = await app.request(
      `https://studymix.example/api/uploads/${upload.uploadId}/confirm`,
      { method: "POST" },
      env,
    );
    const row = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?1")
      .bind(upload.uploadId)
      .first<{ status: string }>();

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
    expect(row?.status).toBe("deleted");
  });

  it("deletes only an owner-scoped upload and its one server-controlled object", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `https://studymix.example/api/uploads/${upload.uploadId}`,
      { method: "DELETE" },
      otherOwnerEnvironment,
    );
    expect(denied.status).toBe(404);
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).not.toBeNull();

    const deleted = await app.request(
      `https://studymix.example/api/uploads/${upload.uploadId}`,
      { method: "DELETE" },
      env,
    );

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      data: { status: "deleted", uploadId: upload.uploadId },
    });
    expect(await env.AUDIO_BUCKET.head(upload.objectKey)).toBeNull();
  });

  it("signs a ready output download only for the owning user", async () => {
    const { upload } = await requestUpload();
    await env.AUDIO_BUCKET.put(upload.objectKey, new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    await app.request(
      `https://studymix.example/api/uploads/${upload.uploadId}/confirm`,
      { method: "POST" },
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
    const outputKey = `owners/${owner.id}/outputs/${outputId}/candidate`;
    await createOutput(env.DB, {
      candidateIndex: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      id: outputId,
      jobId: job.job.id,
      objectKey: outputKey,
      ownerId: owner.id,
    });
    await env.AUDIO_BUCKET.put(outputKey, new Uint8Array([5, 6, 7, 8]), {
      httpMetadata: { contentType: "audio/mpeg" },
    });
    await env.DB.prepare(
      "UPDATE outputs SET status = 'ready', content_type = 'audio/mpeg', size_bytes = 4 WHERE id = ?1",
    )
      .bind(outputId)
      .run();

    const otherOwnerEnvironment: Env = { ...env, DEV_AUTH_SUBJECT: "second-test-owner" };
    const denied = await app.request(
      `https://studymix.example/api/outputs/${outputId}/download`,
      { method: "POST" },
      otherOwnerEnvironment,
    );
    const response = await app.request(
      `https://studymix.example/api/outputs/${outputId}/download`,
      { method: "POST" },
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

  it("fails closed before creating metadata when signed transfer is disabled", async () => {
    const disabledEnvironment: Env = { ...env, R2_TRANSFER_ENABLED: "false" };
    const response = await app.request(
      "https://studymix.example/api/uploads",
      {
        body: JSON.stringify({
          contentType: "audio/mpeg",
          originalFilename: "fixture.mp3",
          sizeBytes: 4,
        }),
        headers: { "Content-Type": "application/json" },
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

  it("atomically limits active uploads per owner before returning another signed URL", async () => {
    await requestUpload();
    await requestUpload();
    await requestUpload();
    const response = await app.request(
      "https://studymix.example/api/uploads",
      {
        body: JSON.stringify({
          contentType: "audio/mpeg",
          originalFilename: "fourth.mp3",
          sizeBytes: 4,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      env,
    );
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM uploads").first<{
      total: number;
    }>();

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(count?.total).toBe(3);
  });
});
