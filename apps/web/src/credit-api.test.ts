import { describe, expect, it, vi } from "vitest";
import { CreditApiError, getCreditSummary } from "./credit-api";

const validCreditEnvelope = {
  data: {
    availableCredits: 8,
    plan: "private-beta",
    reservedCredits: 2,
    settledCredits: 4,
    status: "active",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  error: null,
  requestId: "credit-request-1",
};

describe("private beta credit API client", () => {
  it("accepts only a strict owner aggregate response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(validCreditEnvelope));

    await expect(getCreditSummary(new AbortController().signal, request)).resolves.toMatchObject({
      availableCredits: 8,
      reservedCredits: 2,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/credits",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it.each([
    ["network failure", new TypeError("Synthetic credit network failure.")],
    ["request timeout", new DOMException("Synthetic credit timeout.", "TimeoutError")],
  ])("recovers one %s by repeating the same owner aggregate GET", async (_caseName, error) => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(Response.json(validCreditEnvelope));
    const signal = new AbortController().signal;

    await expect(getCreditSummary(signal, request)).resolves.toMatchObject({
      availableCredits: 8,
      reservedCredits: 2,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/credits",
      "/api/credits",
    ]);
    expect(request.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  it("limits transport recovery to one retry", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic first credit failure."))
      .mockRejectedValueOnce(new TypeError("Synthetic second credit failure."));

    await expect(getCreditSummary(new AbortController().signal, request)).rejects.toBeInstanceOf(
      CreditApiError,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry a caller abort", async () => {
    const callerAbort = new DOMException("Synthetic caller abort.", "AbortError");
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(callerAbort);

    await expect(getCreditSummary(new AbortController().signal, request)).rejects.toBe(callerAbort);
    expect(request).toHaveBeenCalledOnce();
  });

  it("fails closed for malformed or error responses", async () => {
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: { availableCredits: -1 }, error: null, requestId: "bad-credit" }),
      );
    const denied = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          data: null,
          error: { code: "ENTITLEMENT_REQUIRED", message: "Unavailable", retryable: false },
          requestId: "credit-denied",
        },
        { status: 403 },
      ),
    );

    await expect(getCreditSummary(new AbortController().signal, malformed)).rejects.toBeInstanceOf(
      CreditApiError,
    );
    await expect(getCreditSummary(new AbortController().signal, denied)).rejects.toBeInstanceOf(
      CreditApiError,
    );
    expect(malformed).toHaveBeenCalledOnce();
    expect(denied).toHaveBeenCalledOnce();
  });
});
