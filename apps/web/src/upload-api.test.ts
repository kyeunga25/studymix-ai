import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadApiError, createDirectUpload, uploadAndConfirmAudio } from "./upload-api";

const uploadId = "upl_0123456789abcdef0123456789abcdef";
const objectKey = `owners/own_${"1".repeat(32)}/uploads/${uploadId}/source`;
const now = "2026-07-25T08:00:00.000Z";

function apiResponse(data: unknown, status = 200): Response {
  return Response.json({ data, error: null, requestId: "request-001" }, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("direct R2 upload client", () => {
  it("creates, directly uploads, and confirms without sending audio through the API", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "study.m4a", { type: "audio/x-m4a" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        apiResponse(
          {
            allowedContentTypes: ["audio/mp4"],
            expiresAt: now,
            maxUploadBytes: 524_288_000,
            objectKey,
            requiredHeaders: { "Content-Type": "audio/mp4", "If-None-Match": "*" },
            uploadId,
            uploadMethod: "PUT",
            uploadUrl: "https://example.r2.cloudflarestorage.com/signed-upload",
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        apiResponse({
          confirmedAt: now,
          createdAt: now,
          declaredContentType: "audio/mp4",
          expiresAt: now,
          originalFilename: "study.m4a",
          sizeBytes: 3,
          status: "confirmed",
          uploadId,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAndConfirmAudio(file)).resolves.toMatchObject({ status: "confirmed" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.r2.cloudflarestorage.com/signed-upload",
      expect.objectContaining({
        body: file,
        headers: { "Content-Type": "audio/mp4", "If-None-Match": "*" },
        method: "PUT",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      contentType: "audio/mp4",
      originalFilename: "study.m4a",
      sizeBytes: 3,
    });
  });

  it("rejects unsupported files before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createDirectUpload(new File(["text"], "notes.txt", { type: "text/plain" })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests owner-scoped cleanup after a failed direct PUT", async () => {
    const file = new File([new Uint8Array([1])], "study.mp3", { type: "audio/mpeg" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        apiResponse(
          {
            allowedContentTypes: ["audio/mpeg"],
            expiresAt: now,
            maxUploadBytes: 524_288_000,
            objectKey,
            requiredHeaders: { "Content-Type": "audio/mpeg", "If-None-Match": "*" },
            uploadId,
            uploadMethod: "PUT",
            uploadUrl: "https://example.r2.cloudflarestorage.com/signed-upload",
          },
          201,
        ),
      )
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
});
