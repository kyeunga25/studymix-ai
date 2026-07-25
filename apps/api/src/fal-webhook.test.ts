import { describe, expect, it } from "vitest";
import { FalWebhookAuthenticationError, verifyFalWebhook } from "./fal-webhook";

const encoder = new TextEncoder();
const nowMilliseconds = Date.UTC(2026, 6, 26, 1, 2, 3);
const expectedUserId = "test-fal-user";
const providerRequestId = "fal-request-verified-1";

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signedWebhook(
  bodyValue: unknown,
  timestampSeconds = Math.floor(nowMilliseconds / 1_000),
): Promise<Readonly<{ fetcher: typeof fetch; request: Request }>> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  if (!("privateKey" in keyPair)) {
    throw new TypeError("Expected an Ed25519 key pair.");
  }
  const body = JSON.stringify(bodyValue);
  const bodyBytes = encoder.encode(body);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bodyBytes));
  const message = encoder.encode(
    [providerRequestId, expectedUserId, timestampSeconds.toString(), toHex(digest)].join("\n"),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, message),
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        keys: [
          {
            crv: "Ed25519",
            kty: "OKP",
            use: "sig",
            x: toBase64Url(publicKey),
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  return {
    fetcher,
    request: new Request("https://studymix.example/api/webhooks/fal", {
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Fal-Webhook-Request-Id": providerRequestId,
        "X-Fal-Webhook-Signature": toHex(signature),
        "X-Fal-Webhook-Timestamp": timestampSeconds.toString(),
        "X-Fal-Webhook-User-Id": expectedUserId,
      },
      method: "POST",
    }),
  };
}

describe("fal webhook verification", () => {
  it("verifies the raw body and returns only the minimal completion signal", async () => {
    const fixture = await signedWebhook({
      payload: { audio: { url: "https://untrusted.example.test/output" } },
      request_id: providerRequestId,
      status: "OK",
    });

    await expect(
      verifyFalWebhook(fixture.request, expectedUserId, {
        fetcher: fixture.fetcher,
        nowMilliseconds,
      }),
    ).resolves.toEqual({ providerRequestId, status: "OK" });
  });

  it("rejects a body changed after signing", async () => {
    const fixture = await signedWebhook({ request_id: providerRequestId, status: "OK" });
    const tampered = new Request(fixture.request, {
      body: JSON.stringify({ request_id: providerRequestId, status: "ERROR" }),
    });

    await expect(
      verifyFalWebhook(tampered, expectedUserId, {
        fetcher: fixture.fetcher,
        nowMilliseconds,
      }),
    ).rejects.toBeInstanceOf(FalWebhookAuthenticationError);
  });

  it("rejects stale timestamps and an unexpected fal user", async () => {
    const stale = await signedWebhook(
      { request_id: providerRequestId, status: "OK" },
      Math.floor(nowMilliseconds / 1_000) - 301,
    );
    const current = await signedWebhook({ request_id: providerRequestId, status: "OK" });

    await expect(
      verifyFalWebhook(stale.request, expectedUserId, {
        fetcher: stale.fetcher,
        nowMilliseconds,
      }),
    ).rejects.toBeInstanceOf(FalWebhookAuthenticationError);
    await expect(
      verifyFalWebhook(current.request, "different-fal-user", {
        fetcher: current.fetcher,
        nowMilliseconds,
      }),
    ).rejects.toBeInstanceOf(FalWebhookAuthenticationError);
  });
});
