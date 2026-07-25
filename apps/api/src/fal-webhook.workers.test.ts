import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleFalWebhook } from "./fal-webhook";
import { app } from "./index";

const now = "2026-07-26T01:02:03.000Z";
const nowMilliseconds = Date.parse(now);
const ownerId = "own_11111111111111111111111111111111";
const uploadId = "upl_22222222222222222222222222222222";
const jobId = "job_33333333333333333333333333333333";
const providerRequestId = "fal-request-known-1";

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

async function createSignedRequest(
  requestId: string,
): Promise<Readonly<{ fetcher: typeof fetch; request: Request }>> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  if (!("privateKey" in keyPair)) {
    throw new TypeError("Expected an Ed25519 key pair.");
  }
  const body = JSON.stringify({
    payload: { ignored: "The application never stores this callback payload." },
    request_id: requestId,
    status: "OK",
  });
  const timestamp = Math.floor(nowMilliseconds / 1_000).toString();
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const message = new TextEncoder().encode(
    [requestId, "test-fal-user", timestamp, toHex(digest)].join("\n"),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, message),
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        keys: [{ crv: "Ed25519", kty: "OKP", use: "sig", x: toBase64Url(publicKey) }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  return {
    fetcher,
    request: new Request("https://studymix.example/api/webhooks/fal", {
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Fal-Webhook-Request-Id": requestId,
        "X-Fal-Webhook-Signature": toHex(signature),
        "X-Fal-Webhook-Timestamp": timestamp,
        "X-Fal-Webhook-User-Id": "test-fal-user",
      },
      method: "POST",
    }),
  };
}

async function copyRequestToUrl(request: Request, url: string): Promise<Request> {
  return new Request(url, {
    body: await request.clone().arrayBuffer(),
    headers: request.headers,
    method: request.method,
  });
}

function realGenerationEnvironment(): Env {
  return {
    ...env,
    DOWNLOAD_URL_TTL_SECONDS: "900",
    FAL_KEY: "test-only-fal-credential-000001",
    GENERATION_PROVIDER: "fal",
    REAL_GENERATION_ENABLED: "true",
  };
}

async function seedKnownProviderRequest(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO owners (
       id, kind, auth_issuer, auth_subject_hash, status, created_at, last_seen_at
     ) VALUES (?1, 'development', 'test', ?2, 'active', ?3, ?3)`,
  )
    .bind(ownerId, "a".repeat(64), now)
    .run();
  await env.DB.prepare(
    `INSERT INTO uploads (
       id, owner_id, object_key, original_filename, declared_content_type,
       size_bytes, status, created_at, confirmed_at, expires_at
     ) VALUES (?1, ?2, ?3, 'fixture.wav', 'audio/wav', 4, 'confirmed', ?4, ?4, ?5)`,
  )
    .bind(
      uploadId,
      ownerId,
      `owners/${ownerId}/uploads/${uploadId}/source`,
      now,
      "2026-07-27T00:00:00.000Z",
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO jobs (
       id, owner_id, upload_id, preset_id, preset_version, status,
       idempotency_key, request_fingerprint, workflow_instance_id,
       candidate_count, provider, error_code, created_at, updated_at,
       completed_at, expires_at
     ) VALUES (
       ?1, ?2, ?3, 'soft-piano', 1, 'generating',
       'webhook-test-request', ?4, ?1, 2, 'fal', NULL, ?5, ?5, NULL, ?6
     )`,
  )
    .bind(jobId, ownerId, uploadId, "b".repeat(64), now, "2026-08-02T00:00:00.000Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO provider_requests (
       id, job_id, candidate_index, provider, provider_request_id, status,
       seed, submitted_at, completed_at, cost_estimate_usd, error_code
     ) VALUES (?1, ?2, 0, 'fal', ?3, 'submitted', NULL, ?4, NULL, NULL, NULL)`,
  )
    .bind("req_44444444444444444444444444444444", jobId, providerRequestId, now)
    .run();
}

describe("fal webhook boundary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM usage_events").run();
    await env.DB.prepare("DELETE FROM rights_declarations").run();
    await env.DB.prepare("DELETE FROM outputs").run();
    await env.DB.prepare("DELETE FROM provider_requests").run();
    await env.DB.prepare("DELETE FROM jobs").run();
    await env.DB.prepare("DELETE FROM uploads").run();
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("bypasses user authentication but rejects an unsigned callback before touching owners", async () => {
    const response = await app.request(
      "https://studymix.example/api/webhooks/fal",
      { body: "{}", headers: { "Content-Type": "application/json" }, method: "POST" },
      realGenerationEnvironment(),
    );
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(401);
    expect(response.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "UNAUTHORIZED", retryable: false },
      requestId: expect.any(String),
    });
    expect(ownerCount?.total).toBe(0);
  });

  it("signals only the known Workflow request and discards the callback payload", async () => {
    await seedKnownProviderRequest();
    const fixture = await createSignedRequest(providerRequestId);
    const signals: Array<Readonly<{ candidateIndex: 0 | 1; providerRequestId: string }>> = [];
    const response = await handleFalWebhook(fixture.request, realGenerationEnvironment(), {
      fetcher: fixture.fetcher,
      nowMilliseconds,
      async sendSignal(workflowInstanceId, signal) {
        expect(workflowInstanceId).toBe(jobId);
        signals.push(signal);
      },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      data: { accepted: true },
      error: null,
      requestId: expect.any(String),
    });
    expect(signals).toEqual([{ candidateIndex: 0, providerRequestId }]);
    const persistedPayload = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM provider_requests WHERE error_code IS NOT NULL",
    ).first<{ total: number }>();
    expect(persistedPayload?.total).toBe(0);

    await env.DB.prepare(
      "UPDATE provider_requests SET status = 'completed', completed_at = ?1 WHERE provider_request_id = ?2",
    )
      .bind(now, providerRequestId)
      .run();
    const duplicate = await createSignedRequest(providerRequestId);
    const duplicateResponse = await handleFalWebhook(
      duplicate.request,
      realGenerationEnvironment(),
      {
        fetcher: duplicate.fetcher,
        nowMilliseconds,
        async sendSignal() {
          throw new Error("A completed callback must be acknowledged without another signal.");
        },
      },
    );
    expect(duplicateResponse.status).toBe(202);
  });

  it("rejects a signed callback for an unknown provider request", async () => {
    const fixture = await createSignedRequest("fal-request-unknown-1");
    const response = await handleFalWebhook(fixture.request, realGenerationEnvironment(), {
      fetcher: fixture.fetcher,
      nowMilliseconds,
      async sendSignal() {
        throw new Error("An unknown request must not signal a Workflow.");
      },
    });

    expect(response.status).toBe(404);
  });

  it("rejects callbacks outside the configured exact origin and path", async () => {
    const fixture = await createSignedRequest(providerRequestId);
    const wrongOrigin = await copyRequestToUrl(
      fixture.request,
      "https://alternate.example/api/webhooks/fal",
    );
    const queryBearing = await copyRequestToUrl(
      fixture.request,
      "https://studymix.example/api/webhooks/fal?token=not-accepted",
    );
    const dependencies = {
      fetcher: fixture.fetcher,
      nowMilliseconds,
      async sendSignal() {
        throw new Error("A non-exact callback URL must not signal a Workflow.");
      },
    };

    await expect(
      handleFalWebhook(wrongOrigin, realGenerationEnvironment(), dependencies).then(
        (response) => response.status,
      ),
    ).resolves.toBe(404);
    await expect(
      handleFalWebhook(queryBearing, realGenerationEnvironment(), dependencies).then(
        (response) => response.status,
      ),
    ).resolves.toBe(404);
  });
});
