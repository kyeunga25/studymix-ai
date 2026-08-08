import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../index";

describe("Worker authentication boundary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM credit_ledger").run();
    await env.DB.prepare("DELETE FROM owner_entitlements").run();
    await env.DB.prepare("DELETE FROM workspace_memberships").run();
    await env.DB.prepare("DELETE FROM workspace_controls").run();
    await env.DB.prepare("DELETE FROM owner_invitations").run();
    await env.DB.prepare("DELETE FROM workspaces").run();
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("returns 401 before touching D1 when a protected production request is unauthenticated", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "a".repeat(64),
      ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
      APP_ENV: "production",
      DEV_AUTH_SUBJECT: "must-not-be-used-in-production",
      OWNER_IDENTITY_PEPPER: "p".repeat(64),
    };
    const response = await app.request(
      "https://studymix.example/api/auth/me",
      undefined,
      productionEnv,
    );
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "UNAUTHORIZED", retryable: false },
    });
    expect(ownerCount?.total).toBe(0);
  });

  it("persists only the server-resolved development owner for API requests", async () => {
    const response = await app.request("https://studymix.example/api/session", undefined, env);
    const body: unknown = await response.json();
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        authorization: {
          accountStatus: "active",
          aiJobApprovalMode: "manual",
          membershipStatus: "active",
          paymentStatus: "disabled",
          permissions: expect.arrayContaining(["workspace:manage", "approvals:manage"]),
          realProviderStatus: "disabled",
          role: "owner",
          workspaceStatus: "active",
        },
        capabilities: {
          creditAccounting: true,
          localAiHarness: false,
          mockGeneration: true,
          privateAudioUpload: true,
          realGeneration: false,
          retentionCleanup: true,
        },
        kind: "development",
      },
      error: null,
    });
    expect(ownerCount?.total).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/ownerId|workspaceId/);
  });

  it("rejects an authenticated owner whose beta access has been disabled", async () => {
    const initialResponse = await app.request(
      "https://studymix.example/api/auth/me",
      undefined,
      env,
    );
    const initialBody = (await initialResponse.json()) as { data: unknown };
    expect(initialResponse.status).toBe(200);
    expect(initialBody.data).not.toBeNull();

    await env.DB.prepare("UPDATE owners SET status = 'disabled'").run();

    const deniedResponse = await app.request(
      "https://studymix.example/api/auth/me",
      undefined,
      env,
    );

    expect(deniedResponse.status).toBe(403);
    expect(await deniedResponse.json()).toMatchObject({
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "This account is not permitted to use StudyMix AI.",
        retryable: false,
      },
    });
  });

  it("serves the public product page without creating an owner", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "CHANGE_ME",
      ACCESS_TEAM_DOMAIN: "https://CHANGE-ME.cloudflareaccess.com",
      APP_ENV: "production",
      OWNER_IDENTITY_PEPPER: "",
    };
    const response = await app.request("https://studymix.example/", undefined, productionEnv);
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("test asset");
    expect(ownerCount?.total).toBe(0);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
  });

  it("protects the application shell while leaving health checks public", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "a".repeat(64),
      ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
      APP_ENV: "production",
      OWNER_IDENTITY_PEPPER: "p".repeat(64),
    };
    const application = await app.request("https://studymix.example/app", undefined, productionEnv);
    const deepApplication = await app.request(
      "https://studymix.example/app/settings",
      undefined,
      productionEnv,
    );
    const apiParent = await app.request("https://studymix.example/api", undefined, productionEnv);
    const health = await app.request("https://studymix.example/health", undefined, productionEnv);
    const privateHealth = await app.request(
      "https://studymix.example/api/health",
      undefined,
      productionEnv,
    );

    expect(application.status).toBe(401);
    expect(deepApplication.status).toBe(401);
    expect(apiParent.status).toBe(401);
    expect(application.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
    expect(health.status).toBe(200);
    expect(privateHealth.status).toBe(401);
    expect(await health.json()).toMatchObject({ data: { status: "ok" }, error: null });
  });

  it("adds the private R2 origin only to a successful authenticated application response", async () => {
    const response = await app.request("https://studymix.example/app", undefined, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(env.R2_ACCOUNT_ID);
  });

  it("does not serve the SPA shell after the active workspace membership is disabled", async () => {
    const initial = await app.request("https://studymix.example/app", undefined, env);
    expect(initial.status).toBe(200);
    await env.DB.prepare("UPDATE workspace_memberships SET status = 'disabled'").run();

    const denied = await app.request("https://studymix.example/app/settings", undefined, env);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toBe("test asset");
  });

  it("rejects a cross-workspace assertion before an API handler runs", async () => {
    const initial = await app.request("https://studymix.example/api/session", undefined, env);
    expect(initial.status).toBe(200);

    const denied = await app.request(
      "https://studymix.example/api/session",
      { headers: { "X-Workspace-Id": `wsp_${"9".repeat(32)}` } },
      env,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      data: null,
      error: { code: "FORBIDDEN", retryable: false },
    });
  });
});
