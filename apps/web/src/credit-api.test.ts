import { describe, expect, it, vi } from "vitest";
import { CreditApiError, getCreditSummary } from "./credit-api";

describe("private beta credit API client", () => {
  it("accepts only a strict owner aggregate response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
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
      }),
    );

    await expect(getCreditSummary(new AbortController().signal, request)).resolves.toMatchObject({
      availableCredits: 8,
      reservedCredits: 2,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/credits",
      expect.objectContaining({ credentials: "same-origin" }),
    );
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
  });
});
