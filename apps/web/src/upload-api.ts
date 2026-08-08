import {
  apiEnvelopeSchema,
  audioContentTypeSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  deleteUploadResponseSchema,
  publicUploadSchema,
  type ApiErrorCode,
  type ApiEnvelope,
  type AudioContentType,
  type CreateUploadResponse,
  type PublicUpload,
} from "@studymix/contracts";
import type { ZodType } from "zod";
import { fetchPrivateApi } from "./private-api";

const createUploadEnvelopeSchema = apiEnvelopeSchema(createUploadResponseSchema);
const publicUploadEnvelopeSchema = apiEnvelopeSchema(publicUploadSchema);
const deleteUploadEnvelopeSchema = apiEnvelopeSchema(deleteUploadResponseSchema);
const clientMaxUploadBytes = 524_288_000;

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

function invalidResponseError(): UploadApiError {
  return new UploadApiError({
    code: "INVALID_RESPONSE",
    message: "The upload service returned an invalid response.",
    retryable: true,
  });
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
    body = await response.json();
  } catch {
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

export async function createDirectUpload(
  file: File,
  signal?: AbortSignal,
): Promise<CreateUploadResponse> {
  const contentType = normalizeAudioContentType(file);
  if (contentType === null || file.size > clientMaxUploadBytes) {
    throw new UploadApiError({
      code: "VALIDATION_ERROR",
      message: "Select a supported audio file no larger than 500 MB.",
      retryable: false,
    });
  }
  const request = createUploadRequestSchema.safeParse({
    contentType,
    originalFilename: file.name,
    sizeBytes: file.size,
  });
  if (!request.success) {
    throw new UploadApiError({
      code: "VALIDATION_ERROR",
      message: "Select a supported audio file no larger than 500 MB.",
      retryable: false,
    });
  }

  try {
    const response = await fetchPrivateApi("/api/uploads", {
      body: JSON.stringify(request.data),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...signalOption(signal),
    });
    const upload = await parseApiResponse<CreateUploadResponse>(
      response,
      createUploadEnvelopeSchema,
    );
    return upload;
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function deleteUpload(uploadId: string, signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetchPrivateApi(`/api/uploads/${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
      ...signalOption(signal),
    });
    await parseApiResponse(response, deleteUploadEnvelopeSchema);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function uploadAndConfirmAudio(
  file: File,
  signal?: AbortSignal,
): Promise<PublicUpload> {
  const upload = await createDirectUpload(file, signal);
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

    const confirmResponse = await fetchPrivateApi(
      `/api/uploads/${encodeURIComponent(upload.uploadId)}/confirm`,
      {
        method: "POST",
        ...signalOption(signal),
      },
    );
    return await parseApiResponse<PublicUpload>(confirmResponse, publicUploadEnvelopeSchema);
  } catch (error) {
    try {
      await deleteUpload(upload.uploadId, signal);
    } catch {
      // The server-side expiry path remains the fallback for an interrupted cleanup request.
    }
    normalizeFetchError(error);
  }
}
