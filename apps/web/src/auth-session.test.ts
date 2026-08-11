import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrivateSession } from "./auth-session";

const validSession = {
  data: {
    authorization: {
      accountStatus: "active",
      aiJobApprovalMode: "manual",
      membershipStatus: "active",
      paymentStatus: "disabled",
      permissions: [
        "workspace:read",
        "workspace:manage",
        "jobs:create",
        "jobs:read",
        "credits:read",
        "approvals:manage",
      ],
      realProviderStatus: "disabled",
      role: "owner",
      workspaceStatus: "active",
    },
    capabilities: {
      creditAccounting: false,
      localAiHarness: false,
      mockGeneration: true,
      privateAudioUpload: false,
      realGeneration: false,
      retentionCleanup: false,
    },
    kind: "authenticated",
  },
  error: null,
  requestId: "req_0123456789abcdef0123456789abcdef",
};

function validSessionResponse(): Response {
  return new Response(JSON.stringify(validSession), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("private session loader", () => {
  it("requests an AJAX-safe Access response and accepts a valid active session", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(validSessionResponse());

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toMatchObject({
      status: "verified",
      session: validSession.data,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      }),
    );
  });

  it.each([
    [401, "signed-out"],
    [403, "denied"],
    [503, "unavailable"],
  ] as const)("maps HTTP %s to %s without accepting workspace data", async (status, expected) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("service response", { status }));

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toEqual({
      session: null,
      status: expected,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a successful response does not match the session contract", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ...validSession, data: { kind: "authenticated" } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toEqual({
      session: null,
      status: "unavailable",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails closed before consuming an oversized successful response", async () => {
    const response = new Response("{}", {
      headers: {
        "Content-Length": "65537",
        "Content-Type": "application/json",
      },
    });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toEqual({
      session: null,
      status: "unavailable",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(false);
  });

  it("retries the same session read once after a transport failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Synthetic session transport failure."))
      .mockResolvedValueOnce(validSessionResponse());

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toMatchObject({
      status: "verified",
      session: validSession.data,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => input)).toEqual(["/api/session", "/api/session"]);
    for (const [, init] of request.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        }),
      );
    }
  });

  it("retries one request deadline with a fresh bounded signal", async () => {
    const firstTimeoutController = new AbortController();
    const retryTimeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(firstTimeoutController.signal)
      .mockReturnValueOnce(retryTimeoutController.signal);
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            const requestSignal = init?.signal;
            if (!(requestSignal instanceof AbortSignal)) {
              reject(new TypeError("Expected a bounded request signal."));
              return;
            }
            requestSignal.addEventListener("abort", () => reject(requestSignal.reason), {
              once: true,
            });
          }),
      )
      .mockResolvedValueOnce(validSessionResponse());

    const result = loadPrivateSession(new AbortController().signal, request);
    firstTimeoutController.abort(new DOMException("Synthetic session timeout.", "TimeoutError"));

    await expect(result).resolves.toMatchObject({ status: "verified", session: validSession.data });
    expect(request).toHaveBeenCalledTimes(2);
    expect(retryTimeoutController.signal.aborted).toBe(false);
  });

  it("maps a second transport failure to unavailable", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Synthetic session transport failure."));

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toEqual({
      session: null,
      status: "unavailable",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry a caller abort", async () => {
    const callerAbort = new DOMException("Synthetic caller abort.", "AbortError");
    const request = vi.fn<typeof fetch>().mockRejectedValue(callerAbort);

    await expect(loadPrivateSession(new AbortController().signal, request)).rejects.toBe(
      callerAbort,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
