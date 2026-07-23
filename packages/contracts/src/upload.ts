import { z } from "zod";
import { httpsUrlSchema, isoDateTimeSchema, uploadIdSchema } from "./common";

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

export const createUploadRequestSchema = z
  .object({
    originalFilename: z.string().trim().min(1).max(255),
    contentType: audioContentTypeSchema,
    sizeBytes: z.number().int().positive().safe(),
  })
  .strict();

export const createUploadResponseSchema = z
  .object({
    uploadId: uploadIdSchema,
    objectKey: z.string().min(1).max(1024),
    uploadUrl: httpsUrlSchema,
    uploadMethod: z.literal("PUT"),
    allowedContentTypes: z.array(audioContentTypeSchema).min(1),
    maxUploadBytes: z.number().int().positive().safe(),
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

export type AudioContentType = z.infer<typeof audioContentTypeSchema>;
export type UploadStatus = z.infer<typeof uploadStatusSchema>;
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;
export type PublicUpload = z.infer<typeof publicUploadSchema>;
