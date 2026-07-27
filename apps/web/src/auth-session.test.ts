import { describe, expect, it, vi } from "vitest";
import { loadPrivateSession } from "./auth-session";

const validSession = {
  data: {
    capabilities: {
      mockGeneration: true,
      privateAudioUpload: false,
      realGeneration: false,
      retentionCleanup: false,
    },
    kind: "authenticated",
    ownerId: "own_0123456789abcdef0123456789abcdef",
  },
  error: null,
  requestId: "req_0123456789abcdef0123456789abcdef",
};

describe("private session loader", () => {
  it("requests an AJAX-safe Access response and accepts a valid active session", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(validSession), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await expect(loadPrivateSession(new AbortController().signal, request)).resolves.toMatchObject({
      status: "verified",
      session: validSession.data,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/auth/me",
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
  });
});
