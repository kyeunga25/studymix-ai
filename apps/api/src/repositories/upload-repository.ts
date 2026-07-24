import { ownerIdSchema, uploadIdSchema } from "@studymix/contracts";
import { z } from "zod";
import { RepositoryNotFoundError } from "./errors";

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
  objectKey: z.string().trim().min(1).max(1024),
  originalFilename: z.string().trim().min(1).max(512),
  ownerId: ownerIdSchema,
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
      ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'pending', ?6, NULL, ?7)
      RETURNING *`,
    )
    .bind(
      parsed.id,
      parsed.ownerId,
      parsed.objectKey,
      parsed.originalFilename,
      parsed.declaredContentType,
      parsed.createdAt,
      parsed.expiresAt,
    )
    .first();

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
): Promise<UploadRecord> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedUploadId = uploadIdSchema.parse(uploadId);
  const parsedSize = z.number().int().nonnegative().safe().parse(sizeBytes);
  const parsedConfirmedAt = z.string().datetime({ offset: true }).parse(confirmedAt);
  const row = await db
    .prepare(
      `UPDATE uploads
       SET status = 'confirmed', size_bytes = ?1, confirmed_at = ?2
       WHERE id = ?3 AND owner_id = ?4 AND status = 'pending' AND expires_at > ?2
       RETURNING *`,
    )
    .bind(parsedSize, parsedConfirmedAt, parsedUploadId, parsedOwnerId)
    .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Upload is not available for confirmation.");
  }

  return mapUploadRow(row);
}
