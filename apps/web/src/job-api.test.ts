import { afterEach, describe, expect, it, vi } from "vitest";
import { createJob, getJob, getOutputDownload } from "./job-api";

const now = "2026-07-25T10:00:00.000Z";
const mockUploadId = "upl_00000000000000000000000000000001";
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

afterEach(() => {
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

  it("preserves safe API retry guidance and request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
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
      ),
    );

    await expect(getJob(validJob.jobId, new AbortController().signal)).rejects.toEqual(
      expect.objectContaining({
        code: "PROVIDER_UNAVAILABLE",
        message: "Generation is temporarily unavailable.",
        requestId: "req_retry",
        retryable: true,
      }),
    );
  });

  it("requests a short-lived private output URL", async () => {
    const outputId = "out_00000000000000000000000000000001";
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        Response.json({
          data: {
            downloadMethod: "GET",
            downloadUrl: "https://00000000000000000000000000000000.r2.cloudflarestorage.com/test",
            expiresAt: "2026-07-25T10:15:00.000Z",
            outputId,
          },
          error: null,
          requestId: "req_download",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOutputDownload(outputId)).resolves.toMatchObject({
      downloadMethod: "GET",
      outputId,
    });
    expect(fetchMock).toHaveBeenCalledWith(`/api/outputs/${outputId}/download`, {
      credentials: "same-origin",
      method: "POST",
    });
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
});
