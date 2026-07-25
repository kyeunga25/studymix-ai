import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../index";

describe("Worker authentication boundary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("returns 401 before touching D1 when a protected production request is unauthenticated", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "a".repeat(64),
      ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
      APP_ENV: "production",
      DEV_AUTH_SUBJECT: "must-not-be-used-in-production",
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
    const response = await app.request("https://studymix.example/api/auth/me", undefined, env);
    const body: unknown = await response.json();
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        kind: "development",
        ownerId: expect.stringMatching(/^own_[0-9a-f]{32}$/),
      },
      error: null,
    });
    expect(ownerCount?.total).toBe(1);
  });

  it("serves the public product page without creating an owner", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "CHANGE_ME",
      ACCESS_TEAM_DOMAIN: "https://CHANGE-ME.cloudflareaccess.com",
      APP_ENV: "production",
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
  });

  it("protects the application shell while leaving health checks public", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "a".repeat(64),
      ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
      APP_ENV: "production",
    };
    const application = await app.request("https://studymix.example/app", undefined, productionEnv);
    const health = await app.request("https://studymix.example/health", undefined, productionEnv);
    const privateHealth = await app.request(
      "https://studymix.example/api/health",
      undefined,
      productionEnv,
    );

    expect(application.status).toBe(401);
    expect(health.status).toBe(200);
    expect(privateHealth.status).toBe(401);
    expect(await health.json()).toMatchObject({ data: { status: "ok" }, error: null });
  });
});
