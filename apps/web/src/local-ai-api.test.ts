import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalSyntheticUpload } from "./local-ai-api";

const now = "2026-08-04T00:00:00.000Z";
const upload = {
  confirmedAt: now,
  createdAt: now,
  declaredContentType: "audio/wav",
  expiresAt: "2026-08-05T00:00:00.000Z",
  originalFilename: "studymix-synthetic-tone.wav",
  sizeBytes: 32_044,
  status: "confirmed",
  uploadId: "upl_0123456789abcdef0123456789abcdef",
} as const;

function localSourceResponse(
  idempotencyKey: string,
  scenario: "success" | "terminal-failure" | "timeout-recovery",
): Response {
  return Response.json({
    data: {
      request: { fixture: "deterministic-tone-v1", idempotencyKey, scenario },
      upload,
    },
    error: null,
    requestId: "req_local_source",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local synthetic source client", () => {
  it("creates a strict deterministic source without browser audio", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        Response.json({
          data: {
            request: {
              fixture: "deterministic-tone-v1",
              idempotencyKey: "ui-local-source-001",
              scenario: "timeout-recovery",
            },
            upload,
          },
          error: null,
          requestId: "req_local_source",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-001",
        scenario: "timeout-recovery",
      }),
    ).resolves.toEqual(upload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/synthetic-upload",
      expect.objectContaining({
        body: JSON.stringify({
          fixture: "deterministic-tone-v1",
          idempotencyKey: "ui-local-source-001",
          scenario: "timeout-recovery",
        }),
        credentials: "same-origin",
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
  });

  it("retries one ambiguous synthetic source failure with the identical request", async () => {
    const request = {
      fixture: "deterministic-tone-v1",
      idempotencyKey: "ui-local-source-network-recovery",
      scenario: "timeout-recovery",
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost local source response"))
      .mockResolvedValueOnce(localSourceResponse(request.idempotencyKey, request.scenario));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createLocalSyntheticUpload(request)).resolves.toEqual(upload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify(request),
      JSON.stringify(request),
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("limits synthetic source recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first local source failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second local source failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-network-limit",
        scenario: "success",
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an aborted synthetic source request without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-aborted",
        scenario: "success",
      }),
    ).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a schema-valid success that is not a confirmed source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          Response.json({
            data: {
              request: {
                fixture: "deterministic-tone-v1",
                idempotencyKey: "ui-local-source-unconfirmed",
                scenario: "success",
              },
              upload: { ...upload, confirmedAt: null, status: "created" },
            },
            error: null,
            requestId: "req_unconfirmed_source",
          }),
        ),
      ),
    );

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-unconfirmed",
        scenario: "success",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
  });

  it.each([
    [
      "another scenario",
      {
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-requested",
        scenario: "terminal-failure",
      },
    ],
    [
      "another idempotency key",
      {
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-stale",
        scenario: "success",
      },
    ],
  ] as const)("rejects a schema-valid success bound to %s", async (_caseName, responseRequest) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: { request: responseRequest, upload },
        error: null,
        requestId: "req_stale_local_source",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-requested",
        scenario: "success",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid scenario before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-002",
        scenario: "unknown",
      } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves safe API errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "RATE_LIMITED",
            message: "Use the active local source first.",
            retryable: true,
          },
          requestId: "req_local_retry",
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-003",
        scenario: "success",
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      requestId: "req_local_retry",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
