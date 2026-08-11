import {
  apiEnvelopeSchema,
  audioContentTypes,
  audioContentTypeSchema,
  createUploadMetadataSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  deleteUploadResponseSchema,
  publicUploadSchema,
  uploadIdSchema,
  type ApiErrorCode,
  type ApiEnvelope,
  type AudioContentType,
  type CreateUploadMetadata,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type PublicUpload,
} from "@studymix/contracts";
import type { ZodType } from "zod";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { fetchPrivateApi } from "./private-api";
import { isTrustedR2PresignedUrl } from "./r2-instruction";
import { isWebRequestInterruption } from "./request-timeout";

const createUploadEnvelopeSchema = apiEnvelopeSchema(createUploadResponseSchema);
const publicUploadEnvelopeSchema = apiEnvelopeSchema(publicUploadSchema);
const deleteUploadEnvelopeSchema = apiEnvelopeSchema(deleteUploadResponseSchema);
const clientMaxUploadBytes = 524_288_000;

export const clientAudioFileAccept = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ...audioContentTypes,
  "audio/x-aac",
  "audio/x-m4a",
].join(",");

export type ClientAudioFileValidationIssue =
  "empty" | "invalid-name" | "multiple" | "too-large" | "unsupported";

export type ClientAudioFileValidationResult =
  | { issue: null; request: CreateUploadMetadata; valid: true }
  | { issue: ClientAudioFileValidationIssue; request: null; valid: false };

export class UploadApiError extends Error {
  readonly code: ApiErrorCode | "DIRECT_UPLOAD_FAILED" | "INVALID_RESPONSE" | "NETWORK_ERROR";
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor({
    code,
    message,
    requestId = null,
    retryable,
  }: {
    code: ApiErrorCode | "DIRECT_UPLOAD_FAILED" | "INVALID_RESPONSE" | "NETWORK_ERROR";
    message: string;
    requestId?: string | null;
    retryable: boolean;
  }) {
    super(message);
    this.name = "UploadApiError";
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

function normalizeAudioContentType(file: File): AudioContentType | null {
  const aliases: Readonly<Record<string, AudioContentType>> = {
    "audio/x-aac": "audio/aac",
    "audio/x-m4a": "audio/mp4",
  };
  const candidate = aliases[file.type.toLowerCase()] ?? file.type.toLowerCase();
  const parsed = audioContentTypeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function validateClientAudioFile(file: File): ClientAudioFileValidationResult {
  const contentType = normalizeAudioContentType(file);
  if (contentType === null) {
    return { issue: "unsupported", request: null, valid: false };
  }
  if (file.size === 0) {
    return { issue: "empty", request: null, valid: false };
  }
  if (file.size > clientMaxUploadBytes) {
    return { issue: "too-large", request: null, valid: false };
  }

  const request = createUploadMetadataSchema.safeParse({
    contentType,
    originalFilename: file.name,
    sizeBytes: file.size,
  });
  return request.success
    ? { issue: null, request: request.data, valid: true }
    : { issue: "invalid-name", request: null, valid: false };
}

function isTrustedDirectUploadInstruction(
  upload: CreateUploadResponse,
  request: CreateUploadRequest,
): boolean {
  return (
    upload.idempotencyKey === request.idempotencyKey &&
    isTrustedR2PresignedUrl({
      expiresAt: upload.expiresAt,
      kind: "upload",
      objectKey: upload.objectKey,
      resourceId: upload.uploadId,
      url: upload.uploadUrl,
    }) &&
    upload.allowedContentTypes.includes(request.contentType) &&
    upload.requiredHeaders["Content-Type"] === request.contentType &&
    upload.maxUploadBytes >= request.sizeBytes
  );
}

function invalidResponseError(): UploadApiError {
  return new UploadApiError({
    code: "INVALID_RESPONSE",
    message: "The upload service returned an invalid response.",
    retryable: true,
  });
}

function invalidAudioFileError(): UploadApiError {
  return new UploadApiError({
    code: "VALIDATION_ERROR",
    message: "Select a supported audio file no larger than 500 MB.",
    retryable: false,
  });
}

function requireClientAudioMetadata(file: File): CreateUploadMetadata {
  const validation = validateClientAudioFile(file);
  if (!validation.valid) {
    throw invalidAudioFileError();
  }
  return validation.request;
}

function createClientUploadRequest(metadata: CreateUploadMetadata): CreateUploadRequest {
  const request = createUploadRequestSchema.safeParse({
    ...metadata,
    idempotencyKey: `ui-upload:${crypto.randomUUID()}`,
  });
  if (!request.success) {
    throw invalidAudioFileError();
  }
  return request.data;
}

function invalidUploadResourceError(): UploadApiError {
  return new UploadApiError({
    code: "VALIDATION_ERROR",
    message: "The upload request is invalid.",
    retryable: false,
  });
}

function isMatchingConfirmedUpload(
  upload: PublicUpload,
  requestedUploadId: string,
  request: CreateUploadRequest,
): boolean {
  if (
    upload.uploadId !== requestedUploadId ||
    upload.originalFilename !== request.originalFilename ||
    upload.declaredContentType !== request.contentType ||
    upload.sizeBytes !== request.sizeBytes ||
    upload.status !== "confirmed" ||
    upload.confirmedAt === null
  ) {
    return false;
  }
  const createdAt = Date.parse(upload.createdAt);
  const confirmedAt = Date.parse(upload.confirmedAt);
  const expiresAt = Date.parse(upload.expiresAt);
  return createdAt <= confirmedAt && confirmedAt < expiresAt && expiresAt > Date.now();
}

function signalOption(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

async function parseApiResponse<T>(
  response: Response,
  schema: ZodType<ApiEnvelope<T>>,
): Promise<T> {
  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
    throw invalidResponseError();
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw invalidResponseError();
  }
  if (parsed.data.error !== null) {
    throw new UploadApiError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      requestId: parsed.data.requestId,
      retryable: parsed.data.error.retryable,
    });
  }
  if (!response.ok) {
    throw invalidResponseError();
  }
  return parsed.data.data;
}

function normalizeFetchError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error;
  }
  if (error instanceof UploadApiError) {
    throw error;
  }
  throw new UploadApiError({
    code: "NETWORK_ERROR",
    message: "The upload service could not be reached.",
    retryable: true,
  });
}

async function requestDirectUploadCreation(
  request: CreateUploadRequest,
  signal?: AbortSignal,
): Promise<CreateUploadResponse> {
  try {
    const response = await fetchPrivateApi("/api/uploads", {
      body: JSON.stringify(request),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...signalOption(signal),
    });
    return await parseApiResponse<CreateUploadResponse>(response, createUploadEnvelopeSchema);
  } catch (error) {
    normalizeFetchError(error);
  }
}

async function createDirectUploadForRequest(
  request: CreateUploadRequest,
  signal?: AbortSignal,
): Promise<CreateUploadResponse> {
  let upload: CreateUploadResponse;
  try {
    upload = await requestDirectUploadCreation(request, signal);
  } catch (error) {
    if (!(error instanceof UploadApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    upload = await requestDirectUploadCreation(request, signal);
  }

  if (upload.idempotencyKey !== request.idempotencyKey) {
    throw invalidResponseError();
  }
  if (!isTrustedDirectUploadInstruction(upload, request)) {
    try {
      await deleteUpload(upload.uploadId);
    } catch {
      // The server-side expiry path remains the fallback for an interrupted cleanup request.
    }
    throw invalidResponseError();
  }
  return upload;
}

async function createDirectUploadForFile(
  file: File,
  signal?: AbortSignal,
): Promise<{ request: CreateUploadRequest; upload: CreateUploadResponse }> {
  const request = createClientUploadRequest(requireClientAudioMetadata(file));
  return {
    request,
    upload: await createDirectUploadForRequest(request, signal),
  };
}

export async function createDirectUpload(
  file: File,
  signal?: AbortSignal,
): Promise<CreateUploadResponse> {
  return (await createDirectUploadForFile(file, signal)).upload;
}

async function requestUploadDeletion(uploadId: string, signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetchPrivateApi(`/api/uploads/${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
      ...signalOption(signal),
    });
    const deleted = await parseApiResponse(response, deleteUploadEnvelopeSchema);
    if (deleted.uploadId !== uploadId) {
      throw invalidResponseError();
    }
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function deleteUpload(uploadId: string, signal?: AbortSignal): Promise<void> {
  const parsedUploadId = uploadIdSchema.safeParse(uploadId);
  if (!parsedUploadId.success) {
    throw invalidUploadResourceError();
  }
  try {
    await requestUploadDeletion(parsedUploadId.data, signal);
  } catch (error) {
    if (!(error instanceof UploadApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    await requestUploadDeletion(parsedUploadId.data, signal);
  }
}

async function requestUploadConfirmation(
  uploadId: string,
  signal?: AbortSignal,
): Promise<PublicUpload> {
  try {
    const response = await fetchPrivateApi(`/api/uploads/${encodeURIComponent(uploadId)}/confirm`, {
      method: "POST",
      ...signalOption(signal),
    });
    return await parseApiResponse<PublicUpload>(response, publicUploadEnvelopeSchema);
  } catch (error) {
    normalizeFetchError(error);
  }
}

async function confirmUploadForRequest(
  uploadId: string,
  request: CreateUploadRequest,
  signal?: AbortSignal,
): Promise<PublicUpload> {
  let confirmed: PublicUpload;
  try {
    confirmed = await requestUploadConfirmation(uploadId, signal);
  } catch (error) {
    if (!(error instanceof UploadApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    confirmed = await requestUploadConfirmation(uploadId, signal);
  }
  if (!isMatchingConfirmedUpload(confirmed, uploadId, request)) {
    throw invalidResponseError();
  }
  return confirmed;
}

export async function uploadAndConfirmAudio(
  file: File,
  signal?: AbortSignal,
): Promise<PublicUpload> {
  const { request, upload } = await createDirectUploadForFile(file, signal);
  try {
    const directResponse = await fetch(upload.uploadUrl, {
      body: file,
      headers: upload.requiredHeaders,
      method: upload.uploadMethod,
      ...signalOption(signal),
    });
    if (!directResponse.ok) {
      throw new UploadApiError({
        code: "DIRECT_UPLOAD_FAILED",
        message: "The private audio upload did not complete.",
        retryable: true,
      });
    }

    return await confirmUploadForRequest(upload.uploadId, request, signal);
  } catch (error) {
    try {
      await deleteUpload(upload.uploadId);
    } catch {
      // The server-side expiry path remains the fallback for an interrupted cleanup request.
    }
    normalizeFetchError(error);
  }
}
