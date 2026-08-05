import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalSyntheticUpload } from "./local-ai-api";

const now = "2026-08-04T00:00:00.000Z";
const upload = {
  confirmedAt: now,
  createdAt: now,
  declaredContentType: "audio/wav",
  expiresAt: "2026-08-05T00:00:00.000Z",
  originalFilename: "studymix-synthetic-tone.wav",
  sizeBytes: 16_044,
  status: "confirmed",
  uploadId: "upl_0123456789abcdef0123456789abcdef",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local synthetic source client", () => {
  it("creates a strict deterministic source without browser audio", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(Response.json({ data: upload, error: null, requestId: "req_local_source" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLocalSyntheticUpload({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-001",
        scenario: "timeout-recovery",
      }),
    ).resolves.toEqual(upload);
    expect(fetchMock).toHaveBeenCalledWith("/api/local/synthetic-upload", {
      body: JSON.stringify({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "ui-local-source-001",
        scenario: "timeout-recovery",
      }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
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
        ),
      ),
    );

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
  });
});
