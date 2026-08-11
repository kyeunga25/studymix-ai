import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelJob,
  createJob,
  deleteJob,
  getJob,
  getOutputDownload,
  getPlayableOutputSource,
} from "./job-api";

const now = "2026-07-25T10:00:00.000Z";
const signedOutputExpiresAt = "2026-07-25T10:01:00.000Z";
const mockUploadId = "upl_00000000000000000000000000000001";
const otherUploadId = "upl_00000000000000000000000000000002";
const mockOutputId = "out_00000000000000000000000000000001";
const otherOutputId = "out_00000000000000000000000000000002";
const otherJobId = "job_00000000000000000000000000000002";
const r2Hostname = `${"0".repeat(32)}.r2.cloudflarestorage.com`;
const validJob = {
  candidateCount: 2,
  completedAt: null,
  createdAt: now,
  errorCode: null,
  expiresAt: "2026-08-01T10:00:00.000Z",
  jobId: "job_00000000000000000000000000000001",
  outputs: [],
  preset: { id: "soft-piano", version: 1 },
  retryPermitted: false,
  status: "created",
  updatedAt: now,
  uploadId: mockUploadId,
} as const;
const keyedJobRequest = {
  candidateCount: 2,
  idempotencyKey: "ui:job-request-001",
  presetId: "soft-piano",
  presetVersion: 1,
  rightsDeclarationVersion: "v1",
  uploadId: mockUploadId,
} as const;

function signedOutputUrl(outputId = mockOutputId): string {
  const objectKey = `owners/own_${"1".repeat(32)}/outputs/${outputId}/candidate`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "SYNTHETIC_ACCESS_KEY/20260725/auto/s3/aws4_request",
    "X-Amz-Date": "20260725T100000Z",
    "X-Amz-Expires": "60",
    "X-Amz-Signature": "b".repeat(64),
    "X-Amz-SignedHeaders": "host",
  });
  return `https://${r2Hostname}/synthetic-private-audio/${objectKey}?${query.toString()}`;
}

type DownloadUrlMutation = (downloadUrl: string) => string;

const invalidDownloadUrlCases = [
  [
    "a non-R2 destination",
    (downloadUrl) => downloadUrl.replace(r2Hostname, "downloads.example.test"),
  ],
  [
    "a non-standard destination port",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.port = "444";
      return url.toString();
    },
  ],
  [
    "a missing signature",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.delete("X-Amz-Signature");
      return url.toString();
    },
  ],
  ["an output path for another ID", () => signedOutputUrl(otherOutputId)],
  [
    "an incomplete credential scope",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.set("X-Amz-Credential", "/auto/s3/aws4_request");
      return url.toString();
    },
  ],
  [
    "an excessive signed lifetime",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.set("X-Amz-Expires", "3601");
      return url.toString();
    },
  ],
  [
    "a credential date inconsistent with the signing date",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.set(
        "X-Amz-Credential",
        "SYNTHETIC_ACCESS_KEY/20260724/auto/s3/aws4_request",
      );
      return url.toString();
    },
  ],
  [
    "an impossible signing date",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.set("X-Amz-Date", "20260732T100000Z");
      return url.toString();
    },
  ],
  [
    "an extra signed header without a matching download instruction",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.set("X-Amz-SignedHeaders", "host;x-unprovided");
      return url.toString();
    },
  ],
  [
    "a duplicate signed header",
    (downloadUrl) => {
      const url = new URL(downloadUrl);
      url.searchParams.set("X-Amz-SignedHeaders", "host;host");
      return url.toString();
    },
  ],
] satisfies readonly (readonly [string, DownloadUrlMutation])[];

function downloadEnvelope(
  downloadUrl: string,
  outputId = mockOutputId,
  expiresAt = signedOutputExpiresAt,
): Response {
  return Response.json({
    data: {
      downloadMethod: "GET",
      downloadUrl,
      expiresAt,
      outputId,
    },
    error: null,
    requestId: "req_download",
  });
}

function syntheticWave(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(48));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("job API client", () => {
  it("accepts a valid public job envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          Response.json({ data: validJob, error: null, requestId: "req_test" }, { status: 202 }),
        ),
      ),
    );

    const job = await createJob({
      candidateCount: 2,
      presetId: "soft-piano",
      presetVersion: 1,
      rightsDeclarationVersion: "v1",
      uploadId: mockUploadId,
    });

    expect(job).toEqual(validJob);
  });

  it("retries one ambiguous keyed creation failure with the exact same request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost job response"))
      .mockResolvedValueOnce(
        Response.json({ data: validJob, error: null, requestId: "req_recovered" }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createJob(keyedJobRequest)).resolves.toEqual(validJob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequestBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    const retryRequestBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(retryRequestBody).toBe(firstRequestBody);
    const firstRequest = JSON.parse(firstRequestBody);
    const retryRequest = JSON.parse(retryRequestBody);
    expect(firstRequest).toEqual(keyedJobRequest);
    expect(retryRequest).toEqual(firstRequest);
  });

  it("limits keyed creation recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first job network failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second job network failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createJob(keyedJobRequest)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not automatically retry an unkeyed job creation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createJob({
        candidateCount: 2,
        presetId: "soft-piano",
        presetVersion: 1,
        rightsDeclarationVersion: "v1",
        uploadId: mockUploadId,
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a keyed API rejection", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "RATE_LIMITED",
            message: "Try again later.",
            retryable: true,
          },
          requestId: "req_rate_limited",
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createJob(keyedJobRequest)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a keyed invalid response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: { ...validJob, uploadId: otherUploadId },
        error: null,
        requestId: "req_invalid_binding",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createJob(keyedJobRequest)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves an aborted keyed creation without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(createJob(keyedJobRequest)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["another upload", { ...validJob, uploadId: otherUploadId }],
    ["another preset", { ...validJob, preset: { id: "music-box", version: 1 } }],
    ["another preset version", { ...validJob, preset: { id: "soft-piano", version: 2 } }],
  ] as const)("rejects a create success bound to %s", async (_caseName, responseJob) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          Response.json({ data: responseJob, error: null, requestId: "req_wrong_create" }),
        ),
      ),
    );

    await expect(
      createJob({
        candidateCount: 2,
        presetId: "soft-piano",
        presetVersion: 1,
        rightsDeclarationVersion: "v1",
        uploadId: mockUploadId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
  });

  it("rejects a malformed server response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.resolve(Response.json({ data: { status: "invented" } }))),
    );

    await expect(getJob(validJob.jobId, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
  });

  it.each([
    ["polling", () => getJob(validJob.jobId, new AbortController().signal)],
    ["cancellation", () => cancelJob(validJob.jobId)],
  ] as const)("rejects a %s response for another job ID", async (_operation, request) => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        Response.json({
          data: { ...validJob, jobId: otherJobId },
          error: null,
          requestId: "req_wrong_job",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["a path suffix", `${validJob.jobId}/candidate`],
    ["a query suffix", `${validJob.jobId}?owner=other`],
    ["the wrong resource prefix", mockOutputId],
    ["a short opaque value", `job_${"a".repeat(31)}`],
  ])("rejects a job ID with %s before polling", async (_caseName, invalidJobId) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJob(invalidJobId, new AbortController().signal)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries one private job read network failure for the same job", async () => {
    const jobUrl = `/api/jobs/${validJob.jobId}`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic job read network failure"))
      .mockResolvedValueOnce(
        Response.json({ data: validJob, error: null, requestId: "req_job_read_recovered" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJob(validJob.jobId, new AbortController().signal)).resolves.toEqual(validJob);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([jobUrl, jobUrl]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("limits private job read recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first job read failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second job read failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJob(validJob.jobId, new AbortController().signal)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps an oversized server response to the safe retryable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response("{}", {
            headers: {
              "Content-Length": "65537",
              "Content-Type": "application/json",
            },
          }),
        ),
      ),
    );

    await expect(getJob(validJob.jobId, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
  });

  it("maps a stalled response-body timeout to a retryable network error", async () => {
    const firstTimeoutController = new AbortController();
    const retryTimeoutController = new AbortController();
    const retryTimeoutError = new DOMException("Synthetic retry timeout.", "TimeoutError");
    retryTimeoutController.abort(retryTimeoutError);
    vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(firstTimeoutController.signal)
      .mockReturnValueOnce(retryTimeoutController.signal);
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new TypeError("Expected a bounded request signal.");
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = getJob(validJob.jobId, new AbortController().signal);
    firstTimeoutController.abort(new DOMException("Synthetic job timeout.", "TimeoutError"));

    await expect(result).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves caller cancellation while reading a response body", async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new TypeError("Expected a bounded request signal.");
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const callerController = new AbortController();
    const result = getJob(validJob.jobId, callerController.signal);
    const abortError = new DOMException("Synthetic navigation.", "AbortError");

    callerController.abort(abortError);

    await expect(result).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves safe API retry guidance and request ID", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        Response.json(
          {
            data: null,
            error: {
              code: "PROVIDER_UNAVAILABLE",
              message: "Generation is temporarily unavailable.",
              retryable: true,
            },
            requestId: "req_retry",
          },
          { status: 503 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJob(validJob.jobId, new AbortController().signal)).rejects.toEqual(
      expect.objectContaining({
        code: "PROVIDER_UNAVAILABLE",
        message: "Generation is temporarily unavailable.",
        requestId: "req_retry",
        retryable: true,
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requests a short-lived private output URL", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(downloadEnvelope(signedOutputUrl())));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).resolves.toMatchObject({
      downloadMethod: "GET",
      outputId: mockOutputId,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/outputs/${mockOutputId}/download`,
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
  });

  it("retries one ambiguous private output instruction failure", async () => {
    const instructionUrl = `/api/outputs/${mockOutputId}/download`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost output instruction response"))
      .mockResolvedValueOnce(downloadEnvelope(signedOutputUrl()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).resolves.toMatchObject({
      downloadMethod: "GET",
      outputId: mockOutputId,
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      instructionUrl,
      instructionUrl,
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("limits private output instruction recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first output instruction failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second output instruction failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an aborted output instruction without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOutputDownload(mockOutputId, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry an output instruction API error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "OUTPUT_NOT_READY",
            message: "The output is not ready.",
            retryable: true,
          },
          requestId: "req_output_not_ready",
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).rejects.toMatchObject({
      code: "OUTPUT_NOT_READY",
      requestId: "req_output_not_ready",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("accepts the exact local output route only when the local harness is verified", async () => {
    const downloadUrl = `/api/local/outputs/${mockOutputId}/content`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.resolve(downloadEnvelope(downloadUrl))),
    );

    await expect(
      getOutputDownload(mockOutputId, { allowLocalContent: true }),
    ).resolves.toMatchObject({ downloadUrl, outputId: mockOutputId });
  });

  it("fetches verified local audio with private headers and returns a blob source", async () => {
    const downloadUrl = `/api/local/outputs/${mockOutputId}/content`;
    const bytes = syntheticWave();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (path === `/api/outputs/${mockOutputId}/download`) {
        return downloadEnvelope(downloadUrl);
      }
      if (path === downloadUrl) {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-Requested-With")).toBe("XMLHttpRequest");
        expect(init?.credentials).toBe("same-origin");
        return new Response(bytes, {
          headers: {
            "Content-Length": bytes.byteLength.toString(),
            "Content-Type": "audio/wav",
          },
        });
      }
      throw new TypeError("Unexpected test request.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-output");

    await expect(getPlayableOutputSource(mockOutputId, { allowLocalContent: true })).resolves.toBe(
      "blob:local-output",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ size: bytes.byteLength, type: "audio/wav" }),
    );
  });

  it("does not retry a failed local audio content fetch", async () => {
    const downloadUrl = `/api/local/outputs/${mockOutputId}/content`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(downloadEnvelope(downloadUrl))
      .mockRejectedValueOnce(new TypeError("Synthetic local audio network failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getPlayableOutputSource(mockOutputId, { allowLocalContent: true }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/outputs/${mockOutputId}/download`,
      downloadUrl,
    ]);
  });

  it("leaves a trusted private R2 source direct instead of buffering it", async () => {
    const downloadUrl = signedOutputUrl();
    const fetchMock = vi.fn(async () => Promise.resolve(downloadEnvelope(downloadUrl)));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");

    await expect(getPlayableOutputSource(mockOutputId)).resolves.toBe(downloadUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("maps invalid local audio to a safe retryable response error", async () => {
    const downloadUrl = `/api/local/outputs/${mockOutputId}/content`;
    const bytes = syntheticWave();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(downloadEnvelope(downloadUrl))
        .mockResolvedValueOnce(
          new Response(bytes, {
            headers: {
              "Content-Length": bytes.byteLength.toString(),
              "Content-Type": "text/plain",
            },
          }),
        ),
    );
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");

    await expect(
      getPlayableOutputSource(mockOutputId, { allowLocalContent: true }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("rejects a local output route when the local harness is not verified", async () => {
    const downloadUrl = `/api/local/outputs/${mockOutputId}/content`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.resolve(downloadEnvelope(downloadUrl))),
    );

    await expect(getOutputDownload(mockOutputId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
  });

  it("rejects an expired local output route even when the local harness is verified", async () => {
    const downloadUrl = `/api/local/outputs/${mockOutputId}/content`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(downloadEnvelope(downloadUrl, mockOutputId, "2026-07-25T09:59:59.999Z")),
      ),
    );

    await expect(
      getOutputDownload(mockOutputId, { allowLocalContent: true }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
  });

  it.each(invalidDownloadUrlCases)("rejects %s", async (_caseName, mutateDownloadUrl) => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(downloadEnvelope(mutateDownloadUrl(signedOutputUrl()))),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "an expiry inconsistent with the signed lifetime",
      signedOutputUrl(),
      "2026-07-25T10:02:00.000Z",
    ],
    [
      "an expired signed lifetime",
      (() => {
        const url = new URL(signedOutputUrl());
        url.searchParams.set("X-Amz-Date", "20260725T095800Z");
        return url.toString();
      })(),
      "2026-07-25T09:59:00.000Z",
    ],
    [
      "a signature too far in the future",
      (() => {
        const url = new URL(signedOutputUrl());
        url.searchParams.set("X-Amz-Date", "20260725T100600Z");
        return url.toString();
      })(),
      "2026-07-25T10:07:00.000Z",
    ],
  ] as const)("rejects %s", async (_caseName, downloadUrl, expiresAt) => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(downloadEnvelope(downloadUrl, mockOutputId, expiresAt)),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response for another output ID", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(downloadEnvelope(signedOutputUrl(otherOutputId), otherOutputId));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(mockOutputId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requests owner-scoped private job deletion", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        Response.json({
          data: { jobId: validJob.jobId, status: "deleted" },
          error: null,
          requestId: "req_delete",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJob(validJob.jobId)).resolves.toEqual({
      jobId: validJob.jobId,
      status: "deleted",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/jobs/${validJob.jobId}`,
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.any(Headers),
        method: "DELETE",
      }),
    );
  });

  it("retries one ambiguous private deletion failure for the same job", async () => {
    const deletedResponse = Response.json({
      data: { jobId: validJob.jobId, status: "deleted" },
      error: null,
      requestId: "req_delete_recovered",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost deletion response"))
      .mockResolvedValueOnce(deletedResponse);
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJob(validJob.jobId)).resolves.toEqual({
      jobId: validJob.jobId,
      status: "deleted",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/jobs/${validJob.jobId}`,
      `/api/jobs/${validJob.jobId}`,
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("limits private deletion recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first deletion failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second deletion failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJob(validJob.jobId)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an aborted private deletion without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJob(validJob.jobId)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a deletion response for another job ID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: { jobId: otherJobId, status: "deleted" },
        error: null,
        requestId: "req_wrong_delete",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJob(validJob.jobId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requests local owner-scoped job cancellation", async () => {
    const cancelledJob = { ...validJob, status: "cancelled" } as const;
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        Response.json({
          data: cancelledJob,
          error: null,
          requestId: "req_cancel",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelJob(validJob.jobId)).resolves.toEqual(cancelledJob);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/jobs/${validJob.jobId}/cancel`,
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
  });

  it("retries one ambiguous local cancellation failure for the same job", async () => {
    const cancelledJob = { ...validJob, status: "cancelled" } as const;
    const cancellationUrl = `/api/jobs/${validJob.jobId}/cancel`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost cancellation response"))
      .mockResolvedValueOnce(
        Response.json({
          data: cancelledJob,
          error: null,
          requestId: "req_cancel_recovered",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelJob(validJob.jobId)).resolves.toEqual(cancelledJob);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      cancellationUrl,
      cancellationUrl,
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("limits local cancellation recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first cancellation failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second cancellation failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelJob(validJob.jobId)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an aborted local cancellation without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelJob(validJob.jobId)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a terminal local cancellation conflict", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "CONFLICT",
            message: "The job can no longer be cancelled.",
            retryable: false,
          },
          requestId: "req_cancel_conflict",
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelJob(validJob.jobId)).rejects.toMatchObject({
      code: "CONFLICT",
      requestId: "req_cancel_conflict",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves safe retry guidance when private deletion is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "INTERNAL_ERROR",
            message: "Private deletion is temporarily unavailable.",
            retryable: true,
          },
          requestId: "req_delete_retry",
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJob(validJob.jobId)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: "req_delete_retry",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid job request before calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createJob({
        candidateCount: 2,
        presetId: "soft-piano",
        presetVersion: 0,
        rightsDeclarationVersion: "v1",
        uploadId: mockUploadId,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails fast for invalid mutation and output resource IDs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const invalidJobId = `${validJob.jobId}/other-owner`;
    const invalidOutputId = `${mockOutputId}?download=1`;

    await expect(cancelJob(invalidJobId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    await expect(deleteJob(invalidJobId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    await expect(getOutputDownload(invalidOutputId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
