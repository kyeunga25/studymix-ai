import {
  currentLegalDocumentVersions,
  legalDocumentsManifestSchema,
  type LegalDocumentsManifest,
} from "@studymix/contracts";
import { z } from "zod";

const legalConfigurationSchema = z.object({
  APP_ENV: z.enum(["local", "development", "test", "staging", "production"]),
  LEGAL_CONTACT_EMAIL: z.email(),
});

const reservedContactDomainPattern =
  /@(?:example(?:\.(?:com|net|org))?|localhost|[^@]+\.(?:invalid|localhost|test))$/i;

export class LegalConfigurationError extends Error {
  override readonly name = "LegalConfigurationError";
}

export function resolveLegalDocumentsManifest(
  environment: Pick<Env, "APP_ENV" | "LEGAL_CONTACT_EMAIL">,
): LegalDocumentsManifest {
  const parsed = legalConfigurationSchema.safeParse(environment);
  if (!parsed.success) {
    throw new LegalConfigurationError("Legal contact configuration is invalid.");
  }

  if (
    (parsed.data.APP_ENV === "production" || parsed.data.APP_ENV === "staging") &&
    reservedContactDomainPattern.test(parsed.data.LEGAL_CONTACT_EMAIL)
  ) {
    throw new LegalConfigurationError("A real legal contact is required outside local testing.");
  }

  return legalDocumentsManifestSchema.parse({
    contactEmail: parsed.data.LEGAL_CONTACT_EMAIL.toLowerCase(),
    effectiveAt: "2026-08-05T00:00:00.000Z",
    documents: [
      {
        documentId: "terms-of-use",
        path: "/legal/terms",
        requiresAcceptance: true,
        summary: {
          en: "Rules for the private beta and authorized use of the service.",
          "zh-HK": "私密測試及獲授權使用服務的規則。",
        },
        title: { en: "Terms of Use", "zh-HK": "使用條款" },
        version: currentLegalDocumentVersions["terms-of-use"],
      },
      {
        documentId: "privacy-notice",
        path: "/legal/privacy",
        requiresAcceptance: false,
        summary: {
          en: "What data is used, why, where it may go, and how long it is kept.",
          "zh-HK": "說明資料種類、用途、接收方及保留安排。",
        },
        title: { en: "Privacy Notice", "zh-HK": "私隱通知" },
        version: currentLegalDocumentVersions["privacy-notice"],
      },
      {
        documentId: "acceptable-use",
        path: "/legal/acceptable-use",
        requiresAcceptance: true,
        summary: {
          en: "Content, rights, privacy, safety, and anti-abuse restrictions.",
          "zh-HK": "內容、權利、私隱、安全及防濫用限制。",
        },
        title: { en: "Acceptable Use Policy", "zh-HK": "可接受使用政策" },
        version: currentLegalDocumentVersions["acceptable-use"],
      },
      {
        documentId: "ai-output-notice",
        path: "/legal/ai-output-notice",
        requiresAcceptance: true,
        summary: {
          en: "AI output, copyright, quality, and third-party-provider limitations.",
          "zh-HK": "AI 輸出、版權、質素及第三方供應商限制。",
        },
        title: { en: "AI and Output Notice", "zh-HK": "AI 及輸出聲明" },
        version: currentLegalDocumentVersions["ai-output-notice"],
      },
    ],
  });
}
