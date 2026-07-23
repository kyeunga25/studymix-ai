import { describe, expect, it } from "vitest";
import {
  apiEnvelopeSchema,
  createJobRequestSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  publicJobSchema,
  publicPresetSchema,
} from "./index";

const uploadId = "upl_0123456789abcdef0123456789abcdef";
const jobId = "job_0123456789abcdef0123456789abcdef";
const now = "2026-07-24T00:00:00.000Z";

describe("upload contracts", () => {
  it("accepts supported audio upload metadata", () => {
    expect(
      createUploadRequestSchema.parse({
        originalFilename: "study.wav",
        contentType: "audio/wav",
        sizeBytes: 1024,
      }),
    ).toEqual({
      originalFilename: "study.wav",
      contentType: "audio/wav",
      sizeBytes: 1024,
    });
  });

  it("rejects unsupported content types and unknown keys", () => {
    expect(
      createUploadRequestSchema.safeParse({
        originalFilename: "study.flac",
        contentType: "audio/flac",
        sizeBytes: 1024,
        objectKey: "user-controlled-key",
      }).success,
    ).toBe(false);
  });

  it("validates the direct upload response", () => {
    const response = {
      uploadId,
      objectKey: `owners/anonymous/uploads/${uploadId}`,
      uploadUrl: "https://uploads.example.test/signed",
      uploadMethod: "PUT",
      allowedContentTypes: ["audio/mpeg", "audio/wav"],
      maxUploadBytes: 524_288_000,
      expiresAt: now,
    };

    expect(createUploadResponseSchema.safeParse(response).success).toBe(true);
    expect(
      createUploadResponseSchema.safeParse({
        ...response,
        uploadUrl: "http://uploads.example.test/insecure",
      }).success,
    ).toBe(false);
  });
});

describe("preset and job contracts", () => {
  it("requires bilingual public preset text", () => {
    expect(
      publicPresetSchema.safeParse({
        id: "soft-piano",
        version: 1,
        displayName: { en: "Soft Piano", "zh-HK": "柔和鋼琴" },
        description: { en: "Calm and sparse", "zh-HK": "平靜而簡約" },
      }).success,
    ).toBe(true);
  });

  it("requires exactly two candidates and a rights version", () => {
    const validRequest = {
      uploadId,
      presetId: "soft-piano",
      presetVersion: 1,
      candidateCount: 2,
      rightsDeclarationVersion: "v1",
      idempotencyKey: "client-request-001",
    };

    expect(createJobRequestSchema.safeParse(validRequest).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ ...validRequest, candidateCount: 1 }).success).toBe(
      false,
    );
    expect(
      createJobRequestSchema.safeParse({ ...validRequest, rightsDeclarationVersion: "" }).success,
    ).toBe(false);
  });

  it("rejects vendor-specific fields from the public job contract", () => {
    const publicJob = {
      jobId,
      uploadId,
      preset: { id: "music-box", version: 1 },
      status: "queued",
      candidateCount: 2,
      outputs: [],
      retryPermitted: false,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      expiresAt: now,
    };

    expect(publicJobSchema.safeParse(publicJob).success).toBe(true);
    expect(
      publicJobSchema.safeParse({
        ...publicJob,
        provider: "fal",
        providerRequestId: "vendor-request",
      }).success,
    ).toBe(false);
  });
});

describe("API envelopes", () => {
  const schema = apiEnvelopeSchema(publicPresetSchema);

  it("accepts a success envelope", () => {
    expect(
      schema.safeParse({
        data: {
          id: "lofi-study",
          version: 1,
          displayName: { en: "Lo-fi Study", "zh-HK": "Lo-fi 學習" },
          description: { en: "Warm and mellow", "zh-HK": "溫暖而柔和" },
        },
        error: null,
        requestId: "req-001",
      }).success,
    ).toBe(true);
  });

  it("accepts a structured error envelope and rejects stack traces", () => {
    expect(
      schema.safeParse({
        data: null,
        error: {
          code: "UPLOAD_EXPIRED",
          message: "The upload has expired.",
          retryable: false,
        },
        requestId: "req-002",
      }).success,
    ).toBe(true);

    expect(
      schema.safeParse({
        data: null,
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal error.",
          retryable: true,
          stack: "secret stack trace",
        },
        requestId: "req-003",
      }).success,
    ).toBe(false);
  });
});
