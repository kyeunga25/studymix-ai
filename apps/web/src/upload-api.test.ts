import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioContentTypes,
  type AudioContentType,
  type CreateUploadResponse,
  type PublicUpload,
} from "@studymix/contracts";
import {
  UploadApiError,
  clientAudioFileAccept,
  createDirectUpload,
  deleteUpload,
  uploadAndConfirmAudio,
  validateClientAudioFile,
} from "./upload-api";

const uploadId = "upl_0123456789abcdef0123456789abcdef";
const otherUploadId = "upl_fedcba9876543210fedcba9876543210";
const uploadIdempotencyUuid = "11111111-1111-4111-8111-111111111111";
const uploadIdempotencyKey = `ui-upload:${uploadIdempotencyUuid}`;
const objectKey = `owners/own_${"1".repeat(32)}/uploads/${uploadId}/source`;
const now = "2026-07-25T08:00:00.000Z";
const signedUploadExpiresAt = "2026-07-25T08:01:00.000Z";
const r2Hostname = `${"0".repeat(32)}.r2.cloudflarestorage.com`;
const signedUploadQuery = new URLSearchParams({
  "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
  "X-Amz-Credential": "SYNTHETIC_ACCESS_KEY/20260725/auto/s3/aws4_request",
  "X-Amz-Date": "20260725T080000Z",
  "X-Amz-Expires": "60",
  "X-Amz-Signature": "a".repeat(64),
  "X-Amz-SignedHeaders": "content-length;content-type;host;if-none-match",
}).toString();
const signedUploadUrl = `https://${r2Hostname}/synthetic-private-audio/${objectKey}?${signedUploadQuery}`;
const confirmedUploadExpiresAt = "2026-07-26T08:00:00.000Z";

function uploadInstructions(contentType: AudioContentType): CreateUploadResponse {
  return {
    allowedContentTypes: [contentType],
    expiresAt: signedUploadExpiresAt,
    idempotencyKey: uploadIdempotencyKey,
    maxUploadBytes: 524_288_000,
    objectKey,
    requiredHeaders: { "Content-Type": contentType, "If-None-Match": "*" },
    uploadId,
    uploadMethod: "PUT",
    uploadUrl: signedUploadUrl,
  };
}

type UploadInstructionMutation = (instructions: CreateUploadResponse) => CreateUploadResponse;

const invalidUploadInstructionCases = [
  [
    "a non-R2 destination",
    (instructions) => ({
      ...instructions,
      uploadUrl: instructions.uploadUrl.replace(r2Hostname, "uploads.example.test"),
    }),
  ],
  [
    "a non-standard destination port",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.port = "444";
      return { ...instructions, uploadUrl: uploadUrl.toString() };
    },
  ],
  [
    "an unsigned destination",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.delete("X-Amz-Signature");
      return { ...instructions, uploadUrl: uploadUrl.toString() };
    },
  ],
  [
    "an expiry inconsistent with the signed lifetime",
    (instructions) => ({ ...instructions, expiresAt: "2026-07-25T08:02:00.000Z" }),
  ],
  [
    "an expired signed lifetime",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.set("X-Amz-Date", "20260725T075800Z");
      return {
        ...instructions,
        expiresAt: "2026-07-25T07:59:00.000Z",
        uploadUrl: uploadUrl.toString(),
      };
    },
  ],
  [
    "a signature too far in the future",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.set("X-Amz-Date", "20260725T080600Z");
      return {
        ...instructions,
        expiresAt: "2026-07-25T08:07:00.000Z",
        uploadUrl: uploadUrl.toString(),
      };
    },
  ],
  [
    "a credential date inconsistent with the signing date",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.set(
        "X-Amz-Credential",
        "SYNTHETIC_ACCESS_KEY/20260724/auto/s3/aws4_request",
      );
      return { ...instructions, uploadUrl: uploadUrl.toString() };
    },
  ],
  [
    "an impossible signing date",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.set("X-Amz-Date", "20260732T080000Z");
      return { ...instructions, uploadUrl: uploadUrl.toString() };
    },
  ],
  [
    "an extra signed header without a matching upload instruction",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.set(
        "X-Amz-SignedHeaders",
        "content-length;content-type;host;if-none-match;x-unprovided",
      );
      return { ...instructions, uploadUrl: uploadUrl.toString() };
    },
  ],
  [
    "a duplicate signed header",
    (instructions) => {
      const uploadUrl = new URL(instructions.uploadUrl);
      uploadUrl.searchParams.set(
        "X-Amz-SignedHeaders",
        "content-length;content-type;host;host;if-none-match",
      );
      return { ...instructions, uploadUrl: uploadUrl.toString() };
    },
  ],
  [
    "a mismatched object key",
    (instructions) => ({
      ...instructions,
      objectKey: `owners/own_${"1".repeat(32)}/uploads/upl_${"f".repeat(32)}/source`,
    }),
  ],
  [
    "a missing allowed content type",
    (instructions) => ({ ...instructions, allowedContentTypes: ["audio/wav"] }),
  ],
  [
    "a mismatched required content type",
    (instructions) => ({
      ...instructions,
      requiredHeaders: { ...instructions.requiredHeaders, "Content-Type": "audio/wav" },
    }),
  ],
  ["an undersized server limit", (instructions) => ({ ...instructions, maxUploadBytes: 2 })],
] satisfies readonly (readonly [string, UploadInstructionMutation])[];

function confirmedUpload(overrides: Partial<PublicUpload> = {}): PublicUpload {
  return {
    confirmedAt: now,
    createdAt: now,
    declaredContentType: "audio/mp4",
    expiresAt: confirmedUploadExpiresAt,
    originalFilename: "study.m4a",
    sizeBytes: 3,
    status: "confirmed",
    uploadId,
    ...overrides,
  };
}

type ConfirmedUploadMutation = (upload: PublicUpload) => PublicUpload;

const invalidConfirmedUploadCases = [
  ["another upload ID", (upload) => ({ ...upload, uploadId: otherUploadId })],
  ["another filename", (upload) => ({ ...upload, originalFilename: "other.m4a" })],
  ["another content type", (upload) => ({ ...upload, declaredContentType: "audio/wav" })],
  ["another byte size", (upload) => ({ ...upload, sizeBytes: 4 })],
  ["a non-confirmed status", (upload) => ({ ...upload, confirmedAt: null, status: "created" })],
  [
    "timestamps in the wrong order",
    (upload) => ({ ...upload, createdAt: "2026-07-25T08:00:01.000Z" }),
  ],
  ["an expired source", (upload) => ({ ...upload, expiresAt: "2026-07-25T07:59:59.999Z" })],
] satisfies readonly (readonly [string, ConfirmedUploadMutation])[];

function apiResponse(data: unknown, status = 200): Response {
  return Response.json({ data, error: null, requestId: "request-001" }, { status });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.spyOn(crypto, "randomUUID").mockReturnValue(uploadIdempotencyUuid);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("direct R2 upload client", () => {
  it("limits the file-picker hint to the supported audio contract and aliases", () => {
    const acceptedTypes = new Set(clientAudioFileAccept.split(","));

    expect(acceptedTypes.has("audio/*")).toBe(false);
    expect(
      [
        ".mp3",
        ".wav",
        ".m4a",
        ".aac",
        ".ogg",
        ...audioContentTypes,
        "audio/x-aac",
        "audio/x-m4a",
      ].every((type) => acceptedTypes.has(type)),
    ).toBe(true);
  });

  it.each([
    ["audio/wav", "audio/wav"],
    ["audio/x-m4a", "audio/mp4"],
    ["audio/x-aac", "audio/aac"],
  ] as const)("accepts %s as %s before upload", (fileType, expectedContentType) => {
    const validation = validateClientAudioFile(
      new File([new Uint8Array([1])], "study-audio.wav", { type: fileType }),
    );

    expect(validation).toEqual({
      issue: null,
      request: {
        contentType: expectedContentType,
        originalFilename: "study-audio.wav",
        sizeBytes: 1,
      },
      valid: true,
    });
  });

  it("classifies unsupported, empty, oversized, and invalid-name files", () => {
    const oversizedFile = new File([new Uint8Array([1])], "oversized.wav", {
      type: "audio/wav",
    });
    Object.defineProperty(oversizedFile, "size", { value: 524_288_001 });

    expect(
      validateClientAudioFile(new File(["text"], "notes.txt", { type: "text/plain" })),
    ).toMatchObject({ issue: "unsupported", valid: false });
    expect(validateClientAudioFile(new File([], "empty.wav", { type: "audio/wav" }))).toMatchObject(
      { issue: "empty", valid: false },
    );
    expect(validateClientAudioFile(oversizedFile)).toMatchObject({
      issue: "too-large",
      valid: false,
    });
    expect(
      validateClientAudioFile(
        new File([new Uint8Array([1])], `${"a".repeat(252)}.wav`, { type: "audio/wav" }),
      ),
    ).toMatchObject({ issue: "invalid-name", valid: false });
  });

  it("creates, directly uploads, and confirms without sending audio through the API", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", { type: "audio/x-m4a" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4"), 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(apiResponse(confirmedUpload()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).resolves.toMatchObject({ status: "confirmed" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      signedUploadUrl,
      expect.objectContaining({
        body: file,
        headers: { "Content-Type": "audio/mp4", "If-None-Match": "*" },
        method: "PUT",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      contentType: "audio/mp4",
      idempotencyKey: uploadIdempotencyKey,
      originalFilename: "study.m4a",
      sizeBytes: 3,
    });
  });

  it("retries one ambiguous confirmation failure for the same private upload", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
      type: "audio/x-m4a",
    });
    const confirmationUrl = `/api/uploads/${uploadId}/confirm`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4"), 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Synthetic lost confirmation response"))
      .mockResolvedValueOnce(apiResponse(confirmedUpload()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).resolves.toEqual(confirmedUpload());
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/uploads",
      signedUploadUrl,
      confirmationUrl,
      confirmationUrl,
    ]);
    expect(fetchMock.mock.calls.slice(2).every(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("limits automatic confirmation recovery to one retry before cleanup", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
      type: "audio/x-m4a",
    });
    const confirmationUrl = `/api/uploads/${uploadId}/confirm`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4"), 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Synthetic first confirmation failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second confirmation failure"))
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/uploads",
      signedUploadUrl,
      confirmationUrl,
      confirmationUrl,
      `/api/uploads/${uploadId}`,
    ]);
  });

  it("does not retry an API confirmation error before cleanup", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
      type: "audio/x-m4a",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4"), 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            data: null,
            error: {
              code: "INTERNAL_ERROR",
              message: "Private confirmation is temporarily unavailable.",
              retryable: true,
            },
            requestId: "req_confirm_retry",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: "req_confirm_retry",
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/uploads",
      signedUploadUrl,
      `/api/uploads/${uploadId}/confirm`,
      `/api/uploads/${uploadId}`,
    ]);
  });

  it("preserves an aborted confirmation without retrying before cleanup", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
      type: "audio/x-m4a",
    });
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4"), 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).rejects.toBe(abortError);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/uploads",
      signedUploadUrl,
      `/api/uploads/${uploadId}/confirm`,
      `/api/uploads/${uploadId}`,
    ]);
  });

  it("retries one ambiguous creation failure with the same idempotency key", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
      type: "audio/x-m4a",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost response"))
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4")))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(apiResponse(confirmedUpload()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).resolves.toMatchObject({ status: "confirmed" });
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const retryRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstRequest).toEqual(retryRequest);
    expect(retryRequest).toMatchObject({ idempotencyKey: uploadIdempotencyKey });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/uploads",
      "/api/uploads",
      signedUploadUrl,
      `/api/uploads/${uploadId}/confirm`,
    ]);
  });

  it("limits automatic creation recovery to one retry", async () => {
    const file = new File([new Uint8Array([1])], "study.mp3", { type: "audio/mpeg" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first network failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second network failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDirectUpload(file)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/uploads",
      "/api/uploads",
    ]);
  });

  it("rejects unsupported files before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createDirectUpload(new File(["text"], "notes.txt", { type: "text/plain" })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the server millisecond precision omitted from the AWS signing date", async () => {
    const file = new File([new Uint8Array([1])], "study.mp3", { type: "audio/mpeg" });
    const instructions = {
      ...uploadInstructions("audio/mpeg"),
      expiresAt: "2026-07-25T08:01:00.789Z",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(apiResponse(instructions, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDirectUpload(file)).resolves.toEqual(instructions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(invalidUploadInstructionCases)(
    "rejects and cleans up %s before transferring audio",
    async (_caseName, mutateInstructions) => {
      const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
        type: "audio/x-m4a",
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          apiResponse(mutateInstructions(uploadInstructions("audio/mp4")), 201),
        )
        .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(createDirectUpload(file)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        "/api/uploads",
        `/api/uploads/${uploadId}`,
      ]);
    },
  );

  it("rejects a mismatched idempotency response without touching its resource", async () => {
    const file = new File([new Uint8Array([1])], "study.mp3", { type: "audio/mpeg" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      apiResponse(
        {
          ...uploadInstructions("audio/mpeg"),
          idempotencyKey: "ui-upload:22222222-2222-4222-8222-222222222222",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDirectUpload(file)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/uploads"]);
  });

  it("requests owner-scoped cleanup after a failed direct PUT", async () => {
    const file = new File([new Uint8Array([1])], "study.mp3", { type: "audio/mpeg" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mpeg"), 201))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).rejects.toBeInstanceOf(UploadApiError);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/uploads/${uploadId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each(invalidConfirmedUploadCases)(
    "rejects and cleans up a confirmation for %s",
    async (_caseName, mutateConfirmation) => {
      const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", {
        type: "audio/x-m4a",
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mp4"), 201))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(apiResponse(mutateConfirmation(confirmedUpload())))
        .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(uploadAndConfirmAudio(file)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        retryable: true,
      });
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        "/api/uploads",
        signedUploadUrl,
        `/api/uploads/${uploadId}/confirm`,
        `/api/uploads/${uploadId}`,
      ]);
    },
  );

  it("retries one ambiguous owner-scoped upload deletion", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost deletion response"))
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteUpload(uploadId)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/uploads/${uploadId}`,
      `/api/uploads/${uploadId}`,
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("limits owner-scoped upload deletion recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first deletion failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second deletion failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteUpload(uploadId)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an aborted upload deletion without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteUpload(uploadId)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry an upload deletion API error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "INTERNAL_ERROR",
            message: "Private upload deletion is temporarily unavailable.",
            retryable: true,
          },
          requestId: "req_upload_delete_retry",
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteUpload(uploadId)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: "req_upload_delete_retry",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("validates deletion IDs and binds the response before clearing local state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId: otherUploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteUpload(`${uploadId}/other`)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(deleteUpload(uploadId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses a fresh bounded API signal to clean up after caller cancellation", async () => {
    const file = new File([new Uint8Array([1])], "study.mp3", { type: "audio/mpeg" });
    const callerController = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(uploadInstructions("audio/mpeg"), 201))
      .mockImplementationOnce(async (_input, init) => {
        callerController.abort();
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          throw new TypeError("Expected the direct upload cancellation signal.");
        }
        signal.throwIfAborted();
        return new Response(null, { status: 200 });
      })
      .mockResolvedValueOnce(apiResponse({ status: "deleted", uploadId }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file, callerController.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/uploads/${uploadId}`,
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );
    const cleanupSignal = fetchMock.mock.calls[2]?.[1]?.signal;
    expect(cleanupSignal?.aborted).toBe(false);
  });
});
