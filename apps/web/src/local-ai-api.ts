import {
  apiEnvelopeSchema,
  createLocalSyntheticUploadRequestSchema,
  publicUploadSchema,
  type ApiErrorCode,
  type CreateLocalSyntheticUploadRequest,
  type PublicUpload,
} from "@studymix/contracts";

const localSyntheticUploadEnvelopeSchema = apiEnvelopeSchema(publicUploadSchema);

export class LocalAiApiError extends Error {
  readonly code: ApiErrorCode | "INVALID_RESPONSE" | "NETWORK_ERROR";
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor({
    code,
    message,
    requestId = null,
    retryable,
  }: {
    code: ApiErrorCode | "INVALID_RESPONSE" | "NETWORK_ERROR";
    message: string;
    requestId?: string | null;
    retryable: boolean;
  }) {
    super(message);
    this.name = "LocalAiApiError";
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

function invalidResponseError(): LocalAiApiError {
  return new LocalAiApiError({
    code: "INVALID_RESPONSE",
    message: "The local synthetic source service returned an invalid response.",
    retryable: true,
  });
}

export async function createLocalSyntheticUpload(
  request: CreateLocalSyntheticUploadRequest,
): Promise<PublicUpload> {
  const parsedRequest = createLocalSyntheticUploadRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new LocalAiApiError({
      code: "VALIDATION_ERROR",
      message: "The local synthetic source request is invalid.",
      retryable: false,
    });
  }

  try {
    const response = await fetch("/api/local/synthetic-upload", {
      body: JSON.stringify(parsedRequest.data),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponseError();
    }
    const parsed = localSyntheticUploadEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponseError();
    }
    if (parsed.data.error !== null) {
      throw new LocalAiApiError({
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof LocalAiApiError) {
      throw error;
    }
    throw new LocalAiApiError({
      code: "NETWORK_ERROR",
      message: "The local synthetic source service could not be reached.",
      retryable: true,
    });
  }
}
