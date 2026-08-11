import { currentLegalAcceptanceDocuments, type LegalAcceptanceStatus } from "@studymix/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isVerifiedCurrentLegalAcceptance, saveCurrentLegalAcceptance } from "./legal-acceptance";

const acceptedAt = "2026-08-10T10:00:00.000Z";
const validStatus: LegalAcceptanceStatus = {
  acceptedAt: {
    "acceptable-use": acceptedAt,
    "ai-output-notice": acceptedAt,
    "terms-of-use": acceptedAt,
  },
  current: true,
  requiredDocuments: currentLegalAcceptanceDocuments.map((document) => ({ ...document })),
};

function acceptanceResponse(status: LegalAcceptanceStatus = validStatus): Response {
  return Response.json({ data: status, error: null, requestId: "req_legal_acceptance" });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("legal acceptance trust boundary", () => {
  it("accepts the exact current document set with server timestamps", () => {
    expect(isVerifiedCurrentLegalAcceptance(validStatus)).toBe(true);
  });

  it.each([
    ["a false current marker", { ...validStatus, current: false }],
    [
      "a missing acceptance timestamp",
      {
        ...validStatus,
        acceptedAt: { ...validStatus.acceptedAt, "acceptable-use": null },
      },
    ],
    [
      "a stale required version",
      {
        ...validStatus,
        requiredDocuments: validStatus.requiredDocuments.map((document) =>
          document.documentId === "acceptable-use"
            ? { ...document, version: "2026-08-04" }
            : document,
        ),
      },
    ],
    [
      "a duplicated required document",
      {
        ...validStatus,
        requiredDocuments: [
          { ...currentLegalAcceptanceDocuments[0] },
          { ...currentLegalAcceptanceDocuments[0] },
          { ...currentLegalAcceptanceDocuments[2] },
        ],
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, LegalAcceptanceStatus]>)(
    "rejects %s",
    (_caseName, status) => {
      expect(isVerifiedCurrentLegalAcceptance(status)).toBe(false);
    },
  );

  it("submits the exact current legal document set", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(acceptanceResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCurrentLegalAcceptance()).resolves.toEqual(validStatus);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/legal/acceptances",
      expect.objectContaining({
        body: JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
        credentials: "same-origin",
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
  });

  it("retries one ambiguous legal acceptance failure with the identical request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic lost acceptance response"))
      .mockResolvedValueOnce(acceptanceResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCurrentLegalAcceptance()).resolves.toEqual(validStatus);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
      JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("limits automatic legal acceptance recovery to one network retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first acceptance failure"))
      .mockRejectedValueOnce(new TypeError("Synthetic second acceptance failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCurrentLegalAcceptance()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an aborted legal acceptance request without retrying", async () => {
    const abortError = new DOMException("Synthetic navigation.", "AbortError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCurrentLegalAcceptance(new AbortController().signal)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a legal document version API error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          data: null,
          error: {
            code: "LEGAL_DOCUMENT_VERSION_MISMATCH",
            message: "Review the current legal documents.",
            retryable: false,
          },
          requestId: "req_legal_version",
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCurrentLegalAcceptance()).rejects.toMatchObject({
      code: "LEGAL_DOCUMENT_VERSION_MISMATCH",
      requestId: "req_legal_version",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry an incomplete legal acceptance success", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      acceptanceResponse({
        ...validStatus,
        acceptedAt: { ...validStatus.acceptedAt, "acceptable-use": null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCurrentLegalAcceptance()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
