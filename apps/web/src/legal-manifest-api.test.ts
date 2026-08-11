import { describe, expect, it, vi } from "vitest";
import { LegalManifestApiError, loadPublicLegalManifest } from "./legal-manifest-api";

const validManifest = {
  contactEmail: "privacy@example.test",
  documents: [
    {
      documentId: "terms-of-use",
      path: "/legal/terms",
      requiresAcceptance: true,
      summary: { en: "Synthetic terms summary", "zh-HK": "合成條款摘要" },
      title: { en: "Terms of Use", "zh-HK": "使用條款" },
      version: "2026-08-05",
    },
    {
      documentId: "privacy-notice",
      path: "/legal/privacy",
      requiresAcceptance: false,
      summary: { en: "Synthetic privacy summary", "zh-HK": "合成私隱摘要" },
      title: { en: "Privacy Notice", "zh-HK": "私隱通知" },
      version: "2026-08-05",
    },
    {
      documentId: "acceptable-use",
      path: "/legal/acceptable-use",
      requiresAcceptance: true,
      summary: { en: "Synthetic use summary", "zh-HK": "合成使用摘要" },
      title: { en: "Acceptable Use Policy", "zh-HK": "可接受使用政策" },
      version: "2026-08-05",
    },
    {
      documentId: "ai-output-notice",
      path: "/legal/ai-output-notice",
      requiresAcceptance: true,
      summary: { en: "Synthetic AI summary", "zh-HK": "合成 AI 摘要" },
      title: { en: "AI and Output Notice", "zh-HK": "AI 及輸出聲明" },
      version: "2026-08-05",
    },
  ],
  effectiveAt: "2026-08-05T00:00:00.000Z",
};

function validManifestResponse(): Response {
  return Response.json({ data: validManifest, error: null, requestId: "legal-manifest-request-1" });
}

describe("public legal manifest client", () => {
  it("accepts only the strict public manifest from the same origin", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(validManifestResponse());

    await expect(loadPublicLegalManifest(new AbortController().signal, request)).resolves.toEqual(
      validManifest,
    );
    expect(request).toHaveBeenCalledWith(
      "/legal/documents.json",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it.each([
    ["network failure", new TypeError("Synthetic legal manifest network failure.")],
    ["request timeout", new DOMException("Synthetic legal manifest timeout.", "TimeoutError")],
  ])("recovers one %s by repeating the public GET", async (_caseName, error) => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(validManifestResponse());

    await expect(loadPublicLegalManifest(new AbortController().signal, request)).resolves.toEqual(
      validManifest,
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => String(input))).toEqual([
      "/legal/documents.json",
      "/legal/documents.json",
    ]);
  });

  it("limits transport recovery to one retry", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first manifest failure."))
      .mockRejectedValueOnce(new TypeError("Synthetic second manifest failure."));

    await expect(
      loadPublicLegalManifest(new AbortController().signal, request),
    ).rejects.toBeInstanceOf(LegalManifestApiError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry a caller abort", async () => {
    const callerAbort = new DOMException("Synthetic caller abort.", "AbortError");
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(callerAbort);

    await expect(loadPublicLegalManifest(new AbortController().signal, request)).rejects.toBe(
      callerAbort,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not retry HTTP, API, or malformed successful responses", async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Unavailable", retryable: false },
          requestId: "legal-manifest-unavailable",
        },
        { status: 503 },
      ),
    );
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { contactEmail: "invalid" }, error: null }));

    await expect(
      loadPublicLegalManifest(new AbortController().signal, unavailable),
    ).rejects.toBeInstanceOf(LegalManifestApiError);
    await expect(
      loadPublicLegalManifest(new AbortController().signal, malformed),
    ).rejects.toBeInstanceOf(LegalManifestApiError);
    expect(unavailable).toHaveBeenCalledOnce();
    expect(malformed).toHaveBeenCalledOnce();
  });
});
