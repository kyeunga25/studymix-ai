import { describe, expect, it, vi } from "vitest";
import { resolveOwnerContext } from "./auth/owner-context";

const validAudience = "a".repeat(64);
const productionEnvironment = {
  ACCESS_AUD: validAudience,
  ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
  APP_ENV: "production",
  DEV_AUTH_SUBJECT: "must-not-be-used-in-production",
  OWNER_IDENTITY_PEPPER: "p".repeat(64),
};

describe("StudyMix authentication boundary", () => {
  it("fails closed when a production request has no Access JWT", async () => {
    const verifier = vi.fn();

    await expect(
      resolveOwnerContext(new Request("https://studymix.example"), productionEnvironment, verifier),
    ).rejects.toMatchObject({
      reason: "AUTH_TOKEN_MISSING",
      status: 401,
    });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("rejects a forged or unverifiable Access JWT", async () => {
    const request = new Request("https://studymix.example", {
      headers: { "Cf-Access-Jwt-Assertion": "forged-token" },
    });

    await expect(
      resolveOwnerContext(request, productionEnvironment, async () => {
        throw new Error("bad signature");
      }),
    ).rejects.toMatchObject({
      reason: "AUTH_TOKEN_INVALID",
      status: 401,
    });
  });

  it("rejects an oversized token before invoking crypto verification", async () => {
    const verifier = vi.fn();
    const request = new Request("https://studymix.example", {
      headers: { "Cf-Access-Jwt-Assertion": "x".repeat(16_385) },
    });

    await expect(
      resolveOwnerContext(request, productionEnvironment, verifier),
    ).rejects.toMatchObject({
      reason: "AUTH_TOKEN_INVALID",
      status: 401,
    });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("derives the owner only from verified identity claims", async () => {
    const request = new Request("https://studymix.example", {
      headers: {
        "Cf-Access-Jwt-Assertion": "verified-token",
        "X-Owner-Id": "own_ffffffffffffffffffffffffffffffff",
      },
    });
    const verifier = vi.fn(async () => ({
      email: "authorized@example.com",
      exp: 1_800_000_000,
      iat: 1_700_000_000,
      nbf: 1_700_000_000,
      sub: "7335d417-61da-459d-899c-0a01c76a2f94",
      type: "app",
    }));

    const first = await resolveOwnerContext(request, productionEnvironment, verifier);
    const second = await resolveOwnerContext(request, productionEnvironment, verifier);

    expect(first).toEqual(second);
    expect(first.kind).toBe("authenticated");
    expect(first.invitationIdentityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.invitationIdentityHash).not.toContain("authorized");
    expect(first.ownerId).toMatch(/^own_[0-9a-f]{32}$/);
    expect(first.ownerId).not.toBe("own_ffffffffffffffffffffffffffffffff");
  });

  it("rejects service-token claims as interactive user identities", async () => {
    const request = new Request("https://studymix.example", {
      headers: { "Cf-Access-Jwt-Assertion": "service-token" },
    });

    await expect(
      resolveOwnerContext(request, productionEnvironment, async () => ({
        sub: "",
        type: "app",
      })),
    ).rejects.toMatchObject({
      reason: "AUTH_TOKEN_INVALID",
    });
  });

  it("uses only the configured development identity outside production", async () => {
    const owner = await resolveOwnerContext(new Request("http://localhost:8787"), {
      ACCESS_AUD: "",
      ACCESS_TEAM_DOMAIN: "",
      APP_ENV: "development",
      DEV_AUTH_SUBJECT: "local-developer",
      OWNER_IDENTITY_PEPPER: "",
    });

    expect(owner.kind).toBe("development");
    expect(owner.ownerId).toMatch(/^own_[0-9a-f]{32}$/);
  });
});
