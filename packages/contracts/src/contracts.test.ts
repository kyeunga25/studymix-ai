import { describe, expect, it } from "vitest";
import {
  currentRightsDeclarationVersion,
  creditSummarySchema,
  apiEnvelopeSchema,
  acceptLegalDocumentsRequestSchema,
  createJobRequestSchema,
  deleteJobResponseSchema,
  createUploadMetadataSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  publicJobSchema,
  publicPresetSchema,
  publicPresetsSchema,
  currentLegalAcceptanceDocuments,
  legalAcceptanceStatusSchema,
  localSyntheticSourceFilename,
  localSyntheticSourceSizeBytes,
  localSyntheticUploadResponseSchema,
  presetIds,
  presetIdSchema,
  publicJobHistorySchema,
} from "./index";

const uploadId = "upl_0123456789abcdef0123456789abcdef";
const jobId = "job_0123456789abcdef0123456789abcdef";
const now = "2026-07-24T00:00:00.000Z";

describe("private-beta credit contracts", () => {
  it("exposes only bounded owner aggregate credit state", () => {
    const summary = {
      availableCredits: 8,
      plan: "private-beta",
      reservedCredits: 2,
      settledCredits: 4,
      status: "active",
      updatedAt: now,
    };

    expect(creditSummarySchema.parse(summary)).toEqual(summary);
    expect(
      creditSummarySchema.safeParse({ ...summary, providerCustomerId: "private-reference" })
        .success,
    ).toBe(false);
    expect(creditSummarySchema.safeParse({ ...summary, availableCredits: -1 }).success).toBe(false);
  });
});

describe("local synthetic source contracts", () => {
  const request = {
    fixture: "deterministic-tone-v1",
    idempotencyKey: "local-source-contract",
    scenario: "success",
  } as const;
  const response = {
    request,
    upload: {
      confirmedAt: now,
      createdAt: now,
      declaredContentType: "audio/wav",
      expiresAt: "2026-07-25T00:00:00.000Z",
      originalFilename: localSyntheticSourceFilename,
      sizeBytes: localSyntheticSourceSizeBytes,
      status: "confirmed",
      uploadId,
    },
  } as const;

  it("binds a versioned confirmed source to its strict request", () => {
    expect(localSyntheticUploadResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    ["an unconfirmed status", { confirmedAt: null, status: "created" }],
    ["another content type", { declaredContentType: "audio/mpeg" }],
    ["another filename", { originalFilename: "other.wav" }],
    ["another byte size", { sizeBytes: localSyntheticSourceSizeBytes - 1 }],
  ] as const)("rejects %s from the fixed fixture response", (_caseName, mutation) => {
    expect(
      localSyntheticUploadResponseSchema.safeParse({
        ...response,
        upload: { ...response.upload, ...mutation },
      }).success,
    ).toBe(false);
  });

  it("rejects extra private source fields", () => {
    expect(
      localSyntheticUploadResponseSchema.safeParse({
        ...response,
        upload: { ...response.upload, objectKey: "private-object-key" },
      }).success,
    ).toBe(false);
  });
});

describe("upload contracts", () => {
  it("separates supported audio metadata from an idempotent upload request", () => {
    expect(
      createUploadMetadataSchema.parse({
        originalFilename: "study.wav",
        contentType: "audio/wav",
        sizeBytes: 1024,
      }),
    ).toEqual({
      originalFilename: "study.wav",
      contentType: "audio/wav",
      sizeBytes: 1024,
    });
    expect(
      createUploadRequestSchema.parse({
        contentType: "audio/wav",
        idempotencyKey: "ui-upload:request-001",
        originalFilename: "study.wav",
        sizeBytes: 1024,
      }),
    ).toMatchObject({ idempotencyKey: "ui-upload:request-001" });
    expect(
      createUploadRequestSchema.safeParse({
        contentType: "audio/wav",
        originalFilename: "study.wav",
        sizeBytes: 1024,
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported content types and unknown keys", () => {
    expect(
      createUploadRequestSchema.safeParse({
        originalFilename: "study.flac",
        contentType: "audio/flac",
        idempotencyKey: "ui-upload:request-002",
        sizeBytes: 1024,
        objectKey: "user-controlled-key",
      }).success,
    ).toBe(false);
  });

  it("validates the direct upload response", () => {
    const response = {
      uploadId,
      idempotencyKey: "ui-upload:request-003",
      objectKey: `owners/anonymous/uploads/${uploadId}`,
      uploadUrl: "https://uploads.example.test/signed",
      uploadMethod: "PUT",
      allowedContentTypes: ["audio/mpeg", "audio/wav"],
      maxUploadBytes: 524_288_000,
      requiredHeaders: {
        "Content-Type": "audio/wav",
        "If-None-Match": "*",
      },
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
  it("exposes the complete six-style MVP contract", () => {
    expect(presetIds).toEqual([
      "soft-piano",
      "music-box",
      "lofi-study",
      "acoustic-ease",
      "slowwave",
      "kissa-jazzhop",
    ]);
    expect(presetIdSchema.parse("acoustic-ease")).toBe("acoustic-ease");
    expect(presetIdSchema.parse("slowwave")).toBe("slowwave");
    expect(presetIdSchema.parse("kissa-jazzhop")).toBe("kissa-jazzhop");

    const publicPresets = presetIds.map((id) => ({
      id,
      version: 1,
      displayName: { en: id, "zh-HK": id },
      description: { en: `${id} description`, "zh-HK": `${id} description` },
    }));
    expect(publicPresetsSchema.parse(publicPresets)).toEqual(publicPresets);
    expect(publicPresetsSchema.safeParse(publicPresets.slice(0, 5)).success).toBe(false);
  });

  it("validates the minimal private job deletion response", () => {
    expect(deleteJobResponseSchema.parse({ jobId, status: "deleted" })).toEqual({
      jobId,
      status: "deleted",
    });
    expect(
      deleteJobResponseSchema.safeParse({ jobId, status: "deleted", objectKey: "private" }).success,
    ).toBe(false);
  });
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
      rightsDeclarationVersion: currentRightsDeclarationVersion,
      idempotencyKey: "client-request-001",
    };

    expect(createJobRequestSchema.safeParse(validRequest).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ ...validRequest, candidateCount: 1 }).success).toBe(
      false,
    );
    expect(
      createJobRequestSchema.safeParse({ ...validRequest, rightsDeclarationVersion: "" }).success,
    ).toBe(false);
    expect(
      createJobRequestSchema.safeParse({ ...validRequest, rightsDeclarationVersion: "v2" }).success,
    ).toBe(false);

    for (const presetId of ["acoustic-ease", "slowwave", "kissa-jazzhop"] as const) {
      expect(createJobRequestSchema.safeParse({ ...validRequest, presetId }).success).toBe(true);
    }
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

  it("bounds recent private jobs and excludes upload or provider details", () => {
    const summary = {
      createdAt: now,
      expiresAt: now,
      jobId,
      preset: { id: "soft-piano", version: 1 },
      status: "queued",
      updatedAt: now,
    };

    expect(publicJobHistorySchema.safeParse({ jobs: [summary] }).success).toBe(true);
    expect(
      publicJobHistorySchema.safeParse({
        jobs: [{ ...summary, provider: "fal", uploadId }],
      }).success,
    ).toBe(false);
    expect(publicJobHistorySchema.safeParse({ jobs: [summary, summary] }).success).toBe(false);
    expect(
      publicJobHistorySchema.safeParse({
        jobs: Array.from({ length: 11 }, (_, index) => ({
          ...summary,
          jobId: `job_${index.toString(16).padStart(32, "0")}`,
        })),
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

describe("legal document contracts", () => {
  it("accepts the exact current acceptance set and a complete status", () => {
    expect(
      acceptLegalDocumentsRequestSchema.safeParse({
        documents: currentLegalAcceptanceDocuments,
      }).success,
    ).toBe(true);

    expect(
      legalAcceptanceStatusSchema.safeParse({
        acceptedAt: {
          "acceptable-use": now,
          "ai-output-notice": now,
          "terms-of-use": now,
        },
        current: true,
        requiredDocuments: currentLegalAcceptanceDocuments,
      }).success,
    ).toBe(true);
  });

  it("rejects duplicated, missing, unknown, and loose legal acceptance fields", () => {
    const duplicated = [
      currentLegalAcceptanceDocuments[0],
      currentLegalAcceptanceDocuments[0],
      currentLegalAcceptanceDocuments[2],
    ];

    expect(acceptLegalDocumentsRequestSchema.safeParse({ documents: duplicated }).success).toBe(
      false,
    );
    expect(
      acceptLegalDocumentsRequestSchema.safeParse({
        documents: currentLegalAcceptanceDocuments.slice(0, 2),
      }).success,
    ).toBe(false);
    expect(
      acceptLegalDocumentsRequestSchema.safeParse({
        documents: [
          ...currentLegalAcceptanceDocuments.slice(0, 2),
          { documentId: "privacy-notice", version: "2026-07-24" },
        ],
      }).success,
    ).toBe(false);
    expect(
      acceptLegalDocumentsRequestSchema.safeParse({
        documents: currentLegalAcceptanceDocuments,
        ownerId: "own_0123456789abcdef0123456789abcdef",
      }).success,
    ).toBe(false);
  });
});
