import { z } from "zod";
import { httpsUrlSchema, idempotencyKeySchema, isoDateTimeSchema, uploadIdSchema } from "./common";

export const audioContentTypes = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
] as const;

export const audioContentTypeSchema = z.enum(audioContentTypes);

export const uploadStatusSchema = z.enum([
  "created",
  "uploading",
  "confirmed",
  "expired",
  "deleted",
  "failed",
]);

export const createUploadMetadataSchema = z
  .object({
    originalFilename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !/\p{Cc}/u.test(value), "Filename contains control characters."),
    contentType: audioContentTypeSchema,
    sizeBytes: z.number().int().positive().safe(),
  })
  .strict();

export const createUploadRequestSchema = createUploadMetadataSchema
  .extend({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const createUploadResponseSchema = z
  .object({
    uploadId: uploadIdSchema,
    idempotencyKey: idempotencyKeySchema,
    objectKey: z.string().min(1).max(1024),
    uploadUrl: httpsUrlSchema,
    uploadMethod: z.literal("PUT"),
    allowedContentTypes: z.array(audioContentTypeSchema).min(1),
    maxUploadBytes: z.number().int().positive().safe(),
    requiredHeaders: z
      .object({
        "Content-Type": audioContentTypeSchema,
        "If-None-Match": z.literal("*"),
      })
      .strict(),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const publicUploadSchema = z
  .object({
    uploadId: uploadIdSchema,
    originalFilename: z.string().min(1).max(255),
    declaredContentType: audioContentTypeSchema,
    sizeBytes: z.number().int().nonnegative().safe(),
    status: uploadStatusSchema,
    createdAt: isoDateTimeSchema,
    confirmedAt: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const deleteUploadResponseSchema = z
  .object({
    uploadId: uploadIdSchema,
    status: z.literal("deleted"),
  })
  .strict();

export type AudioContentType = z.infer<typeof audioContentTypeSchema>;
export type UploadStatus = z.infer<typeof uploadStatusSchema>;
export type CreateUploadMetadata = z.infer<typeof createUploadMetadataSchema>;
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;
export type PublicUpload = z.infer<typeof publicUploadSchema>;
export type DeleteUploadResponse = z.infer<typeof deleteUploadResponseSchema>;
