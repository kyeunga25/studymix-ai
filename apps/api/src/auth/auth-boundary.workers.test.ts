import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app, resolveResponseCacheControl } from "../index";

const browserApiHeaders = {
  [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
} as const;
const falWebhookRoute = { method: "POST", path: "/api/webhooks/fal" } as const;
const expectedPrivateApiRoutes = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/legal/documents" },
  { method: "GET", path: "/api/session" },
  { method: "GET", path: "/api/auth/me" },
  { method: "GET", path: "/api/presets" },
  { method: "GET", path: "/api/credits" },
  { method: "GET", path: "/api/legal/acceptances" },
  { method: "POST", path: "/api/legal/acceptances" },
  { method: "POST", path: "/api/local/synthetic-upload" },
  { method: "POST", path: "/api/uploads" },
  { method: "POST", path: "/api/uploads/:uploadId/confirm" },
  { method: "DELETE", path: "/api/uploads/:uploadId" },
  { method: "POST", path: "/api/jobs" },
  { method: "GET", path: "/api/jobs/:jobId" },
  { method: "POST", path: "/api/jobs/:jobId/cancel" },
  { method: "DELETE", path: "/api/jobs/:jobId" },
  { method: "POST", path: "/api/outputs/:outputId/download" },
  { method: "GET", path: "/api/local/outputs/:outputId/content" },
] as const;
const unmatchedPrivateApiProbes = [
  { method: "GET", path: "/api" },
  { method: "OPTIONS", path: "/api/session" },
  { method: "PATCH", path: "/api/not-registered" },
  { method: "GET", path: "/api/not-registered" },
  { method: "POST", path: "/api/webhooks/fal/extra" },
] as const;

type ApiRouteRegistration = Readonly<{ method: string; path: string }>;

function registeredApiHandlers(): ApiRouteRegistration[] {
  return app.routes
    .filter(
      (route) =>
        route.method !== "ALL" && (route.path === "/api" || route.path.startsWith("/api/")),
    )
    .map(({ method, path }) => ({ method, path }));
}

function registeredPrivateApiHandlers(): ApiRouteRegistration[] {
  return registeredApiHandlers().filter(
    ({ method, path }) => method !== falWebhookRoute.method || path !== falWebhookRoute.path,
  );
}

function materializeRoutePath(path: string): string {
  const materialized = path
    .replace(":uploadId", `upl_${"a".repeat(32)}`)
    .replace(":jobId", `job_${"b".repeat(32)}`)
    .replace(":outputId", `out_${"c".repeat(32)}`);
  if (materialized.includes(":")) {
    throw new TypeError("The private API route matrix contains an unknown parameter.");
  }
  return materialized;
}

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

  it("keeps one reviewed public callback and inventories every private API handler", () => {
    const apiHandlers = registeredApiHandlers();

    expect(
      apiHandlers.filter(
        ({ method, path }) => method === falWebhookRoute.method && path === falWebhookRoute.path,
      ),
    ).toEqual([falWebhookRoute]);
    expect(registeredPrivateApiHandlers()).toEqual(expectedPrivateApiRoutes);
  });

  it("returns 401 before touching D1 for every unauthenticated private API handler", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "a".repeat(64),
      ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
      APP_ENV: "production",
      DEV_AUTH_SUBJECT: "must-not-be-used-in-production",
      OWNER_IDENTITY_PEPPER: "p".repeat(64),
    };
    const routeProbes = [...registeredPrivateApiHandlers(), ...unmatchedPrivateApiProbes];

    for (const { method, path } of routeProbes) {
      const response = await app.request(
        `https://studymix.example${materializeRoutePath(path)}`,
        { headers: browserApiHeaders, method },
        productionEnv,
      );

      expect({ method, path, status: response.status }).toEqual({ method, path, status: 401 });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        data: null,
        error: { code: "UNAUTHORIZED", retryable: false },
      });
    }

    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(ownerCount?.total).toBe(0);
  });

  it("persists only the server-resolved development owner for API requests", async () => {
    const response = await app.request(
      "http://localhost:8787/api/session",
      { headers: browserApiHeaders },
      env,
    );
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

  it("rejects remote test-mode authentication before touching D1", async () => {
    const response = await app.request(
      "https://studymix.example/api/session",
      { headers: browserApiHeaders },
      { ...env, APP_ENV: "test" },
    );
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "INTERNAL_ERROR", retryable: true },
    });
    expect(ownerCount?.total).toBe(0);
  });

  it("rejects every private API handler without browser intent before touching D1", async () => {
    const routeProbes = [...registeredPrivateApiHandlers(), ...unmatchedPrivateApiProbes];
    for (const { method, path } of routeProbes) {
      const response = await app.request(
        `http://localhost:8787${materializeRoutePath(path)}`,
        { method },
        env,
      );

      expect({ method, path, status: response.status }).toEqual({ method, path, status: 403 });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "A same-origin browser request is required.",
          retryable: false,
        },
      });
    }

    const duplicateHeaders = new Headers();
    duplicateHeaders.append(privateApiRequestHeaderName, privateApiRequestHeaderValue);
    duplicateHeaders.append(privateApiRequestHeaderName, "unexpected");
    const invalidRequests: readonly RequestInit[] = [
      {
        body: "{}",
        headers: { [privateApiRequestHeaderName]: "fetch" },
        method: "POST",
      },
      { body: "{}", headers: duplicateHeaders, method: "POST" },
    ];

    for (const request of invalidRequests) {
      const response = await app.request(
        "http://localhost:8787/api/legal/acceptances",
        request,
        env,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "A same-origin browser request is required.",
          retryable: false,
        },
      });
    }

    const sideEffects = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM legal_acceptances) AS legal_acceptances,
        (SELECT COUNT(*) FROM owners) AS owners,
        (SELECT COUNT(*) FROM workspaces) AS workspaces`,
    ).first<{ legal_acceptances: number; owners: number; workspaces: number }>();

    expect(sideEffects).toEqual({ legal_acceptances: 0, owners: 0, workspaces: 0 });
  });

  it("returns private JSON 404 responses instead of assets for unmatched API requests", async () => {
    for (const { method, path } of unmatchedPrivateApiProbes) {
      const response = await app.request(
        `http://localhost:8787${path}`,
        { headers: browserApiHeaders, method },
        env,
      );
      const responseText = await response.text();
      const responseBody: unknown = JSON.parse(responseText);

      expect({ method, path, status: response.status }).toEqual({ method, path, status: 404 });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
      expect(responseText).not.toBe("test asset");
      expect(responseBody).toMatchObject({
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "The requested API route was not found.",
          retryable: false,
        },
      });
    }
  });

  it("rejects an authenticated owner whose beta access has been disabled", async () => {
    const initialResponse = await app.request(
      "http://localhost:8787/api/auth/me",
      { headers: browserApiHeaders },
      env,
    );
    const initialBody = (await initialResponse.json()) as { data: unknown };
    expect(initialResponse.status).toBe(200);
    expect(initialBody.data).not.toBeNull();

    await env.DB.prepare("UPDATE owners SET status = 'disabled'").run();

    const deniedResponse = await app.request(
      "http://localhost:8787/api/auth/me",
      { headers: browserApiHeaders },
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
    expect(response.headers.get("content-security-policy")).toContain("img-src 'self'");
    expect(response.headers.get("content-security-policy")).not.toContain("img-src 'self' data:");
    expect(response.headers.get("content-security-policy")).toContain("style-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("style-src-attr 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("'unsafe-inline'");
    expect(response.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("caches only successful fingerprinted assets with a matching static MIME type", async () => {
    const stylesheet = await app.request(
      "https://studymix.example/assets/index-DCJNakl0.css",
      undefined,
      env,
    );
    const script = await app.request(
      "https://studymix.example/assets/index-C6HMlBYo.js",
      undefined,
      env,
    );
    const image = await app.request(
      "https://studymix.example/assets/study-room-bg-BB9iV8y8.webp",
      undefined,
      env,
    );
    const unhashed = await app.request("https://studymix.example/assets/index.css", undefined, env);

    for (const response of [stylesheet, script, image]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    }
    expect(unhashed.headers.get("cache-control")).toBe("private, no-store");
    expect(
      resolveResponseCacheControl(
        "GET",
        "/assets/index-DCJNakl0.css",
        200,
        "text/html; charset=utf-8",
      ),
    ).toBe("private, no-store");
    expect(resolveResponseCacheControl("GET", "/assets/index-DCJNakl0.css", 404, "text/css")).toBe(
      "private, no-store",
    );
    expect(resolveResponseCacheControl("POST", "/assets/index-DCJNakl0.css", 200, "text/css")).toBe(
      "private, no-store",
    );
  });

  it("protects the application shell while leaving health checks public", async () => {
    const productionEnv: Env = {
      ...env,
      ACCESS_AUD: "a".repeat(64),
      ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
      APP_ENV: "production",
      OWNER_IDENTITY_PEPPER: "p".repeat(64),
    };
    const application = await app.request("http://localhost:8787/app", undefined, productionEnv);
    const deepApplication = await app.request(
      "http://localhost:8787/app/settings",
      undefined,
      productionEnv,
    );
    const apiParent = await app.request("https://studymix.example/api", undefined, productionEnv);
    const health = await app.request("https://studymix.example/health", undefined, productionEnv);
    const privateHealth = await app.request(
      "http://localhost:8787/api/health",
      undefined,
      productionEnv,
    );

    expect(application.status).toBe(303);
    expect(application.headers.get("location")).toBe("/login?next=%2Fapp&reason=session-expired");
    expect(deepApplication.status).toBe(303);
    expect(deepApplication.headers.get("location")).toBe(
      "/login?next=%2Fapp%2Fsettings&reason=session-expired",
    );
    expect(apiParent.status).toBe(401);
    expect(application.headers.get("content-security-policy")).not.toContain(env.R2_ACCOUNT_ID);
    expect(health.status).toBe(200);
    expect(privateHealth.status).toBe(401);
    expect(await health.json()).toMatchObject({ data: { status: "ok" }, error: null });
  });

  it("adds the private R2 origin only to a successful authenticated application response", async () => {
    const response = await app.request("http://localhost:8787/app", undefined, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(env.R2_ACCOUNT_ID);
  });

  it("does not serve the SPA shell after the active workspace membership is disabled", async () => {
    const initial = await app.request("http://localhost:8787/app", undefined, env);
    expect(initial.status).toBe(200);
    await env.DB.prepare("UPDATE workspace_memberships SET status = 'disabled'").run();

    const denied = await app.request("http://localhost:8787/app/settings", undefined, env);
    expect(denied.status).toBe(303);
    expect(denied.headers.get("location")).toBe(
      "/login?next=%2Fapp%2Fsettings&reason=access-denied",
    );
    expect(await denied.text()).not.toBe("test asset");
  });

  it("keeps API failures as JSON while converting application configuration failures to login UI", async () => {
    const invalidProductionEnv: Env = {
      ...env,
      ACCESS_AUD: "CHANGE_ME",
      ACCESS_TEAM_DOMAIN: "https://CHANGE-ME.cloudflareaccess.com",
      APP_ENV: "production",
      OWNER_IDENTITY_PEPPER: "",
    };
    const application = await app.request(
      "http://localhost:8787/app/review?panel=access",
      undefined,
      invalidProductionEnv,
    );
    const api = await app.request(
      "http://localhost:8787/api/session",
      undefined,
      invalidProductionEnv,
    );

    expect(application.status).toBe(303);
    expect(application.headers.get("location")).toBe(
      "/login?next=%2Fapp%2Freview%3Fpanel%3Daccess&reason=verification-failed",
    );
    expect(application.headers.get("cache-control")).toBe("private, no-store");
    expect(api.status).toBe(503);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(await api.json()).toMatchObject({
      data: null,
      error: { code: "INTERNAL_ERROR", retryable: true },
    });
  });

  it("rejects a cross-workspace assertion before an API handler runs", async () => {
    const initial = await app.request(
      "http://localhost:8787/api/session",
      { headers: browserApiHeaders },
      env,
    );
    expect(initial.status).toBe(200);

    const denied = await app.request(
      "http://localhost:8787/api/session",
      {
        headers: {
          ...browserApiHeaders,
          "X-Workspace-Id": `wsp_${"9".repeat(32)}`,
        },
      },
      env,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      data: null,
      error: { code: "FORBIDDEN", retryable: false },
    });
  });
});
