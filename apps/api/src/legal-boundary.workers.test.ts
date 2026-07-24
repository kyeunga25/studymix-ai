import { currentLegalAcceptanceDocuments } from "@studymix/contracts";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "./index";

describe("legal document and acceptance boundary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM legal_acceptances").run();
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
            version: "2026-07-24",
          }),
          expect.objectContaining({
            documentId: "terms-of-use",
            requiresAcceptance: true,
            version: "2026-07-24",
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
      "https://studymix.example/api/legal/acceptances",
      { method: "POST", body: "not-json" },
      env,
    );
    const malformed = await app.request(
      "https://studymix.example/api/legal/acceptances",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
      env,
    );
    const oversized = await app.request(
      "https://studymix.example/api/legal/acceptances",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      "https://studymix.example/api/legal/acceptances",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
    };
    const first = await app.request("https://studymix.example/api/legal/acceptances", request, env);
    const repeated = await app.request(
      "https://studymix.example/api/legal/acceptances",
      request,
      env,
    );
    const status = await app.request(
      "https://studymix.example/api/legal/acceptances",
      undefined,
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
