import { describe, expect, it } from "vitest";
import { LegalConfigurationError, resolveLegalDocumentsManifest } from "./legal-documents";

describe("legal document configuration", () => {
  it("accepts reserved test contacts only in local and test environments", () => {
    expect(
      resolveLegalDocumentsManifest({
        APP_ENV: "test",
        LEGAL_CONTACT_EMAIL: "privacy@example.test",
      }).contactEmail,
    ).toBe("privacy@example.test");

    expect(() =>
      resolveLegalDocumentsManifest({
        APP_ENV: "production",
        LEGAL_CONTACT_EMAIL: "privacy@example.com",
      }),
    ).toThrow(LegalConfigurationError);
  });

  it("accepts a real formatted production contact and emits all current versions", () => {
    const manifest = resolveLegalDocumentsManifest({
      APP_ENV: "production",
      LEGAL_CONTACT_EMAIL: "privacy@not-a-real-domain.dev",
    });

    expect(manifest.contactEmail).toBe("privacy@not-a-real-domain.dev");
    expect(manifest.documents).toHaveLength(4);
    expect(manifest.documents.every((document) => document.version === "2026-08-05")).toBe(true);
  });
});
