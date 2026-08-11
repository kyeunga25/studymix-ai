import { exportJWK, generateKeyPair, SignJWT, type FetchImplementation } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonBodyTooLargeError } from "../request-json";
import { fetchBoundedAccessJwks, resolveOwnerContext } from "./owner-context";

const jwksUrl = "https://example-team.cloudflareaccess.com/cdn-cgi/access/certs";

function fetchOptions(): Parameters<FetchImplementation>[1] {
  return {
    headers: new Headers({ Accept: "application/json" }),
    method: "GET",
    redirect: "manual",
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded Cloudflare Access JWKS fetch", () => {
  it("keeps remote key selection connected to production Access verification", async () => {
    const issuer = "https://bounded-jwks-test.cloudflareaccess.com";
    const audience = "a".repeat(64);
    const keyId = "synthetic-access-key";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      alg: "RS256",
      kid: keyId,
      use: "sig",
    };
    const now = Math.floor(Date.now() / 1_000);
    const token = await new SignJWT({
      email: "approved-user@example.test",
      type: "app",
    })
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("11111111-1111-4111-8111-111111111111")
      .setIssuedAt(now)
      .setNotBefore(now - 1)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "Content-Type": "application/jwk-set+json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const owner = await resolveOwnerContext(
      new Request("https://app.example.test/api/session", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      {
        ACCESS_AUD: audience,
        ACCESS_TEAM_DOMAIN: issuer,
        APP_ENV: "production",
        DEV_AUTH_SUBJECT: "",
        OWNER_IDENTITY_PEPPER: "A".repeat(43),
      },
    );

    expect(owner.kind).toBe("authenticated");
    expect(owner.authIssuer).toBe(issuer);
    expect(owner.invitationIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${issuer}/cdn-cgi/access/certs`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "manual" });
  });

  it("forwards the JOSE request options and returns bounded JSON", async () => {
    const response = Response.json({ keys: [] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetcher);
    const options = fetchOptions();

    const result = await fetchBoundedAccessJwks(jwksUrl, options);

    expect(fetcher).toHaveBeenCalledExactlyOnceWith(jwksUrl, options);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("application/json");
    await expect(result.json()).resolves.toEqual({ keys: [] });
  });

  it("accepts the registered JWK Set media type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response('{"keys":[]}', {
          headers: { "Content-Type": "application/jwk-set+json; charset=utf-8" },
        }),
      ),
    );

    const result = await fetchBoundedAccessJwks(jwksUrl, fetchOptions());

    await expect(result.json()).resolves.toEqual({ keys: [] });
  });

  it("returns non-200 responses untouched for JOSE to classify", async () => {
    const response = new Response("temporarily unavailable", {
      headers: { "Content-Type": "text/plain" },
      status: 503,
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(response));

    const result = await fetchBoundedAccessJwks(jwksUrl, fetchOptions());

    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
  });

  it("rejects a successful response with a non-JSON media type", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('{"keys":[]}', { headers: { "Content-Type": "text/plain" } }),
        ),
    );

    await expect(fetchBoundedAccessJwks(jwksUrl, fetchOptions())).rejects.toThrow(
      "The Access JWKS response must use a JSON media type.",
    );
  });

  it("rejects a declared response above the 32 KiB boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response('{"keys":[]}', {
          headers: {
            "Content-Length": "32769",
            "Content-Type": "application/json",
          },
        }),
      ),
    );

    await expect(fetchBoundedAccessJwks(jwksUrl, fetchOptions())).rejects.toBeInstanceOf(
      JsonBodyTooLargeError,
    );
  });

  it("counts the actual response stream when Content-Length is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response("x".repeat(32_769), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchBoundedAccessJwks(jwksUrl, fetchOptions())).rejects.toBeInstanceOf(
      JsonBodyTooLargeError,
    );
  });
});
