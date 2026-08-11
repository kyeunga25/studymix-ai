import { currentLegalAcceptanceDocuments } from "@studymix/contracts";
import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "./index";

const browserMutationHeaders = {
  [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
} as const;
const jsonBrowserMutationHeaders = {
  ...browserMutationHeaders,
  "Content-Type": "application/json",
} as const;

describe("legal document and acceptance boundary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM legal_acceptances").run();
    await env.DB.prepare("DELETE FROM credit_ledger").run();
    await env.DB.prepare("DELETE FROM owner_entitlements").run();
    await env.DB.prepare("DELETE FROM workspace_memberships").run();
    await env.DB.prepare("DELETE FROM workspace_controls").run();
    await env.DB.prepare("DELETE FROM owner_invitations").run();
    await env.DB.prepare("DELETE FROM workspaces").run();
    await env.DB.prepare("DELETE FROM owners").run();
  });

  it("publishes versioned legal metadata without creating an authenticated owner", async () => {
    const response = await app.request(
      "https://studymix.example/legal/documents.json",
      undefined,
      env,
    );
    const body: unknown = await response.json();
    const ownerCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        contactEmail: "privacy@example.test",
        documents: expect.arrayContaining([
          expect.objectContaining({
            documentId: "privacy-notice",
            requiresAcceptance: false,
            version: "2026-08-05",
          }),
          expect.objectContaining({
            documentId: "terms-of-use",
            requiresAcceptance: true,
            version: "2026-08-05",
          }),
        ]),
      },
      error: null,
    });
    expect(ownerCount?.total).toBe(0);
  });

  it("fails closed when the legal contact configuration is invalid", async () => {
    const invalidEnvironment: Env = { ...env, LEGAL_CONTACT_EMAIL: "CHANGE_ME" };
    const response = await app.request(
      "https://studymix.example/legal/documents.json",
      undefined,
      invalidEnvironment,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "INTERNAL_ERROR", retryable: false },
    });
  });

  it("rejects malformed, oversized, and non-JSON acceptance requests", async () => {
    const nonJson = await app.request(
      "http://localhost:8787/api/legal/acceptances",
      { method: "POST", headers: browserMutationHeaders, body: "not-json" },
      env,
    );
    const malformed = await app.request(
      "http://localhost:8787/api/legal/acceptances",
      {
        method: "POST",
        headers: jsonBrowserMutationHeaders,
        body: "{",
      },
      env,
    );
    const oversized = await app.request(
      "http://localhost:8787/api/legal/acceptances",
      {
        method: "POST",
        headers: jsonBrowserMutationHeaders,
        body: JSON.stringify({ padding: "x".repeat(4_096) }),
      },
      env,
    );

    expect(nonJson.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM legal_acceptances").first<{
        total: number;
      }>(),
    ).toEqual({ total: 0 });
  });

  it("rejects stale versions without recording partial acceptance", async () => {
    const response = await app.request(
      "http://localhost:8787/api/legal/acceptances",
      {
        method: "POST",
        headers: jsonBrowserMutationHeaders,
        body: JSON.stringify({
          documents: currentLegalAcceptanceDocuments.map((document, index) => ({
            ...document,
            version: index === 0 ? "2026-07-23" : document.version,
          })),
        }),
      },
      env,
    );
    const rowCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM legal_acceptances").first<{
      total: number;
    }>();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "LEGAL_DOCUMENT_VERSION_MISMATCH" },
    });
    expect(rowCount?.total).toBe(0);
  });

  it("records the exact current set once and reports current owner status", async () => {
    const request = {
      method: "POST" as const,
      headers: jsonBrowserMutationHeaders,
      body: JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
    };
    const first = await app.request("http://localhost:8787/api/legal/acceptances", request, env);
    const repeated = await app.request("http://localhost:8787/api/legal/acceptances", request, env);
    const status = await app.request(
      "http://localhost:8787/api/legal/acceptances",
      { headers: browserMutationHeaders },
      env,
    );
    const rowCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM legal_acceptances").first<{
      total: number;
    }>();

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      data: {
        acceptedAt: {
          "acceptable-use": expect.any(String),
          "ai-output-notice": expect.any(String),
          "terms-of-use": expect.any(String),
        },
        current: true,
        requiredDocuments: currentLegalAcceptanceDocuments,
      },
      error: null,
    });
    expect(rowCount?.total).toBe(3);
  });
});
