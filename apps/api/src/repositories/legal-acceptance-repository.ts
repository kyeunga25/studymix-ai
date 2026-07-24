import {
  acceptanceRequiredLegalDocumentIdSchema,
  currentLegalAcceptanceDocuments,
  legalAcceptanceStatusSchema,
  legalDocumentVersionSchema,
  ownerIdSchema,
  type LegalAcceptanceStatus,
} from "@studymix/contracts";
import { z } from "zod";

const legalAcceptanceRowSchema = z.object({
  accepted_at: z.string().datetime({ offset: true }),
  document_id: acceptanceRequiredLegalDocumentIdSchema,
  document_version: legalDocumentVersionSchema,
});

export async function getCurrentLegalAcceptanceStatus(
  db: D1Database,
  ownerId: string,
): Promise<LegalAcceptanceStatus> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const result = await db
    .prepare(
      `SELECT document_id, document_version, accepted_at
       FROM legal_acceptances
       WHERE owner_id = ?1 AND (
         (document_id = ?2 AND document_version = ?3) OR
         (document_id = ?4 AND document_version = ?5) OR
         (document_id = ?6 AND document_version = ?7)
       )`,
    )
    .bind(
      parsedOwnerId,
      currentLegalAcceptanceDocuments[0].documentId,
      currentLegalAcceptanceDocuments[0].version,
      currentLegalAcceptanceDocuments[1].documentId,
      currentLegalAcceptanceDocuments[1].version,
      currentLegalAcceptanceDocuments[2].documentId,
      currentLegalAcceptanceDocuments[2].version,
    )
    .all();

  const acceptedAt: LegalAcceptanceStatus["acceptedAt"] = {
    "acceptable-use": null,
    "ai-output-notice": null,
    "terms-of-use": null,
  };

  for (const value of result.results) {
    const row = legalAcceptanceRowSchema.parse(value);
    acceptedAt[row.document_id] = row.accepted_at;
  }

  return legalAcceptanceStatusSchema.parse({
    acceptedAt,
    current: Object.values(acceptedAt).every((value) => value !== null),
    requiredDocuments: currentLegalAcceptanceDocuments,
  });
}

export async function recordCurrentLegalAcceptances(
  db: D1Database,
  ownerId: string,
  acceptedAt: string,
): Promise<LegalAcceptanceStatus> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedAcceptedAt = z.string().datetime({ offset: true }).parse(acceptedAt);
  const statements = currentLegalAcceptanceDocuments.map((document) =>
    db
      .prepare(
        `INSERT INTO legal_acceptances (
          owner_id, document_id, document_version, accepted_at
        ) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (owner_id, document_id, document_version) DO NOTHING`,
      )
      .bind(parsedOwnerId, document.documentId, document.version, parsedAcceptedAt),
  );

  await db.batch(statements);
  return getCurrentLegalAcceptanceStatus(db, parsedOwnerId);
}

export async function hasCurrentLegalAcceptances(
  db: D1Database,
  ownerId: string,
): Promise<boolean> {
  const status = await getCurrentLegalAcceptanceStatus(db, ownerId);
  return status.current;
}
