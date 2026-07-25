import { ownerIdSchema, uploadIdSchema } from "@studymix/contracts";
import { z } from "zod";
import { RepositoryConflictError, RepositoryNotFoundError, RepositoryQuotaError } from "./errors";

const uploadStatusSchema = z.enum(["pending", "confirmed", "expired", "deleted"]);

const uploadRowSchema = z.object({
  confirmed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  declared_content_type: z.string().min(1).max(255),
  expires_at: z.string().datetime({ offset: true }),
  id: uploadIdSchema,
  object_key: z.string().min(1).max(1024),
  original_filename: z.string().min(1).max(512),
  owner_id: ownerIdSchema,
  size_bytes: z.number().int().nonnegative().safe().nullable(),
  status: uploadStatusSchema,
});

const createUploadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  declaredContentType: z.string().trim().min(1).max(255),
  expiresAt: z.string().datetime({ offset: true }),
  id: uploadIdSchema,
  maxActiveUploads: z.number().int().min(1).max(20),
  objectKey: z.string().trim().min(1).max(1024),
  originalFilename: z.string().trim().min(1).max(512),
  ownerId: ownerIdSchema,
  sizeBytes: z.number().int().positive().safe(),
});

export type UploadRecord = {
  confirmedAt: string | null;
  createdAt: string;
  declaredContentType: string;
  expiresAt: string;
  id: string;
  objectKey: string;
  originalFilename: string;
  ownerId: string;
  sizeBytes: number | null;
  status: z.infer<typeof uploadStatusSchema>;
};

export type CreateUploadInput = z.input<typeof createUploadSchema>;

function mapUploadRow(value: unknown): UploadRecord {
  const row = uploadRowSchema.parse(value);
  return {
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    declaredContentType: row.declared_content_type,
    expiresAt: row.expires_at,
    id: row.id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    ownerId: row.owner_id,
    sizeBytes: row.size_bytes,
    status: row.status,
  };
}

export async function createUpload(
  db: D1Database,
  input: CreateUploadInput,
): Promise<UploadRecord> {
  const parsed = createUploadSchema.parse(input);
  const row = await db
    .prepare(
      `INSERT INTO uploads (
        id, owner_id, object_key, original_filename, declared_content_type,
        size_bytes, status, created_at, confirmed_at, expires_at
      )
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL, ?8
      WHERE (
        SELECT COUNT(*) FROM uploads
        WHERE owner_id = ?2
          AND (
            (status = 'pending' AND expires_at > ?7)
            OR status = 'confirmed'
          )
      ) < ?9
      RETURNING *`,
    )
    .bind(
      parsed.id,
      parsed.ownerId,
      parsed.objectKey,
      parsed.originalFilename,
      parsed.declaredContentType,
      parsed.sizeBytes,
      parsed.createdAt,
      parsed.expiresAt,
      parsed.maxActiveUploads,
    )
    .first();

  if (row === null) {
    throw new RepositoryQuotaError("The active upload limit has been reached.");
  }
  return mapUploadRow(row);
}

export async function getOwnedUpload(
  db: D1Database,
  ownerId: string,
  uploadId: string,
): Promise<UploadRecord | null> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedUploadId = uploadIdSchema.parse(uploadId);
  const row = await db
    .prepare("SELECT * FROM uploads WHERE id = ?1 AND owner_id = ?2")
    .bind(parsedUploadId, parsedOwnerId)
    .first();

  return row === null ? null : mapUploadRow(row);
}

export async function confirmOwnedUpload(
  db: D1Database,
  ownerId: string,
  uploadId: string,
  sizeBytes: number,
  confirmedAt: string,
  retentionExpiresAt: string,
): Promise<UploadRecord> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedUploadId = uploadIdSchema.parse(uploadId);
  const parsedSize = z.number().int().nonnegative().safe().parse(sizeBytes);
  const parsedConfirmedAt = z.string().datetime({ offset: true }).parse(confirmedAt);
  const parsedRetentionExpiresAt = z
    .string()
    .datetime({ offset: true })
    .refine(
      (value) => new Date(value).getTime() > new Date(parsedConfirmedAt).getTime(),
      "Retention expiry must be after confirmation.",
    )
    .parse(retentionExpiresAt);
  const row = await db
    .prepare(
      `UPDATE uploads
       SET status = 'confirmed', size_bytes = ?1, confirmed_at = ?2, expires_at = ?5
       WHERE id = ?3 AND owner_id = ?4 AND status = 'pending' AND expires_at > ?2
       RETURNING *`,
    )
    .bind(parsedSize, parsedConfirmedAt, parsedUploadId, parsedOwnerId, parsedRetentionExpiresAt)
    .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Upload is not available for confirmation.");
  }

  return mapUploadRow(row);
}

export async function expireOwnedUpload(
  db: D1Database,
  ownerId: string,
  uploadId: string,
  expiredAt: string,
): Promise<UploadRecord> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedUploadId = uploadIdSchema.parse(uploadId);
  const parsedExpiredAt = z.string().datetime({ offset: true }).parse(expiredAt);
  const row = await db
    .prepare(
      `UPDATE uploads
       SET status = 'expired'
       WHERE id = ?1 AND owner_id = ?2 AND status = 'pending' AND expires_at <= ?3
       RETURNING *`,
    )
    .bind(parsedUploadId, parsedOwnerId, parsedExpiredAt)
    .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Upload is not available for expiry.");
  }
  return mapUploadRow(row);
}

export async function markOwnedUploadDeleted(
  db: D1Database,
  ownerId: string,
  uploadId: string,
): Promise<UploadRecord> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedUploadId = uploadIdSchema.parse(uploadId);
  const row = await db
    .prepare(
      `UPDATE uploads
       SET status = 'deleted'
       WHERE id = ?1
         AND owner_id = ?2
         AND status IN ('pending', 'confirmed', 'expired', 'deleted')
         AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.upload_id = uploads.id)
       RETURNING *`,
    )
    .bind(parsedUploadId, parsedOwnerId)
    .first();

  if (row !== null) {
    return mapUploadRow(row);
  }

  const existing = await getOwnedUpload(db, parsedOwnerId, parsedUploadId);
  if (existing === null) {
    throw new RepositoryNotFoundError("Upload was not found for this owner.");
  }
  throw new RepositoryConflictError("An upload used by a job cannot be deleted directly.");
}
