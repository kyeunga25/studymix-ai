import { z } from "zod";
import {
  httpsUrlSchema,
  idempotencyKeySchema,
  isoDateTimeSchema,
  jobIdSchema,
  outputIdSchema,
  uploadIdSchema,
} from "./common";
import { presetIdSchema, presetReferenceSchema, presetVersionSchema } from "./preset";
import { audioContentTypeSchema } from "./upload";

export const jobStatuses = [
  "created",
  "validating",
  "queued",
  "generating",
  "processing_output",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const;

export const jobStatusSchema = z.enum(jobStatuses);
export const candidateCountSchema = z.literal(2);
export const candidateIndexSchema = z.union([z.literal(0), z.literal(1)]);

export const outputStatusSchema = z.enum(["pending", "ready", "failed", "expired", "deleted"]);

export const currentRightsDeclarationVersion = "v1" as const;
export const rightsDeclarationVersionSchema = z.literal(currentRightsDeclarationVersion);

export const publicOutputSchema = z
  .object({
    outputId: outputIdSchema,
    candidateIndex: candidateIndexSchema,
    status: outputStatusSchema,
    contentType: audioContentTypeSchema.nullable(),
    sizeBytes: z.number().int().nonnegative().safe().nullable(),
    durationSeconds: z.number().nonnegative().finite().nullable(),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const createJobRequestSchema = z
  .object({
    uploadId: uploadIdSchema,
    presetId: presetIdSchema,
    presetVersion: presetVersionSchema,
    candidateCount: candidateCountSchema,
    rightsDeclarationVersion: rightsDeclarationVersionSchema,
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export const publicJobSchema = z
  .object({
    jobId: jobIdSchema,
    uploadId: uploadIdSchema,
    preset: presetReferenceSchema,
    status: jobStatusSchema,
    candidateCount: candidateCountSchema,
    outputs: z.array(publicOutputSchema).max(2),
    retryPermitted: z.boolean(),
    errorCode: z.string().trim().min(1).max(128).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const downloadOutputResponseSchema = z
  .object({
    downloadMethod: z.literal("GET"),
    downloadUrl: httpsUrlSchema,
    expiresAt: isoDateTimeSchema,
    outputId: outputIdSchema,
  })
  .strict();

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type CandidateCount = z.infer<typeof candidateCountSchema>;
export type CandidateIndex = z.infer<typeof candidateIndexSchema>;
export type OutputStatus = z.infer<typeof outputStatusSchema>;
export type PublicOutput = z.infer<typeof publicOutputSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type PublicJob = z.infer<typeof publicJobSchema>;
export type DownloadOutputResponse = z.infer<typeof downloadOutputResponseSchema>;
