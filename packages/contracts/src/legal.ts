import { z } from "zod";
import { isoDateTimeSchema } from "./common";

export const legalDocumentIds = [
  "terms-of-use",
  "privacy-notice",
  "acceptable-use",
  "ai-output-notice",
] as const;

export const acceptanceRequiredLegalDocumentIds = [
  "terms-of-use",
  "acceptable-use",
  "ai-output-notice",
] as const;

export const legalDocumentIdSchema = z.enum(legalDocumentIds);
export const acceptanceRequiredLegalDocumentIdSchema = z.enum(acceptanceRequiredLegalDocumentIds);
export const legalDocumentVersionSchema = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}(?:\.\d+)?$/, "Use a dated legal document version.");

export const currentLegalDocumentVersions = {
  "acceptable-use": "2026-08-05",
  "ai-output-notice": "2026-08-05",
  "privacy-notice": "2026-08-05",
  "terms-of-use": "2026-08-05",
} as const satisfies Record<LegalDocumentId, string>;

export const currentLegalAcceptanceDocuments = [
  {
    documentId: "terms-of-use",
    version: currentLegalDocumentVersions["terms-of-use"],
  },
  {
    documentId: "acceptable-use",
    version: currentLegalDocumentVersions["acceptable-use"],
  },
  {
    documentId: "ai-output-notice",
    version: currentLegalDocumentVersions["ai-output-notice"],
  },
] as const;

const localizedLegalTextSchema = z
  .object({
    en: z.string().trim().min(1).max(200),
    "zh-HK": z.string().trim().min(1).max(200),
  })
  .strict();

export const legalDocumentManifestItemSchema = z
  .object({
    documentId: legalDocumentIdSchema,
    path: z.string().regex(/^\/legal\/[a-z0-9-]+$/),
    requiresAcceptance: z.boolean(),
    summary: localizedLegalTextSchema,
    title: localizedLegalTextSchema,
    version: legalDocumentVersionSchema,
  })
  .strict();

export const legalDocumentsManifestSchema = z
  .object({
    contactEmail: z.email(),
    effectiveAt: isoDateTimeSchema,
    documents: z.array(legalDocumentManifestItemSchema).length(legalDocumentIds.length),
  })
  .strict();

export const legalAcceptanceItemSchema = z
  .object({
    documentId: acceptanceRequiredLegalDocumentIdSchema,
    version: legalDocumentVersionSchema,
  })
  .strict();

export const acceptLegalDocumentsRequestSchema = z
  .object({
    documents: z.array(legalAcceptanceItemSchema).length(acceptanceRequiredLegalDocumentIds.length),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.documents.map((document) => document.documentId);
    if (new Set(ids).size !== acceptanceRequiredLegalDocumentIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each required legal document must appear exactly once.",
        path: ["documents"],
      });
      return;
    }

    for (const documentId of acceptanceRequiredLegalDocumentIds) {
      if (!ids.includes(documentId)) {
        context.addIssue({
          code: "custom",
          message: `Missing required legal document: ${documentId}.`,
          path: ["documents"],
        });
      }
    }
  });

export const legalAcceptanceStatusSchema = z
  .object({
    acceptedAt: z
      .object({
        "acceptable-use": isoDateTimeSchema.nullable(),
        "ai-output-notice": isoDateTimeSchema.nullable(),
        "terms-of-use": isoDateTimeSchema.nullable(),
      })
      .strict(),
    current: z.boolean(),
    requiredDocuments: z
      .array(legalAcceptanceItemSchema)
      .length(acceptanceRequiredLegalDocumentIds.length),
  })
  .strict();

export type LegalDocumentId = z.infer<typeof legalDocumentIdSchema>;
export type AcceptanceRequiredLegalDocumentId = z.infer<
  typeof acceptanceRequiredLegalDocumentIdSchema
>;
export type AcceptLegalDocumentsRequest = z.infer<typeof acceptLegalDocumentsRequestSchema>;
export type LegalAcceptanceStatus = z.infer<typeof legalAcceptanceStatusSchema>;
export type LegalDocumentsManifest = z.infer<typeof legalDocumentsManifestSchema>;
