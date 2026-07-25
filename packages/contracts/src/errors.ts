import { z } from "zod";
import { requestIdSchema } from "./common";

export const apiErrorCodes = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "UPLOAD_EXPIRED",
  "UPLOAD_NOT_CONFIRMED",
  "OUTPUT_EXPIRED",
  "OUTPUT_NOT_READY",
  "RIGHTS_DECLARATION_REQUIRED",
  "LEGAL_ACCEPTANCE_REQUIRED",
  "LEGAL_DOCUMENT_VERSION_MISMATCH",
  "PRESET_NOT_FOUND",
  "ILLEGAL_JOB_TRANSITION",
  "PROVIDER_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const apiErrorCodeSchema = z.enum(apiErrorCodes);

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export function apiSuccessEnvelopeSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z
    .object({
      data: dataSchema,
      error: z.null(),
      requestId: requestIdSchema,
    })
    .strict();
}

export const apiErrorEnvelopeSchema = z
  .object({
    data: z.null(),
    error: apiErrorSchema,
    requestId: requestIdSchema,
  })
  .strict();

export function apiEnvelopeSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.union([apiSuccessEnvelopeSchema(dataSchema), apiErrorEnvelopeSchema]);
}

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type ApiSuccessEnvelope<T> = {
  data: T;
  error: null;
  requestId: string;
};
export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;
