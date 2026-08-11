import {
  apiEnvelopeSchema,
  createLocalSyntheticUploadRequestSchema,
  localSyntheticUploadResponseSchema,
  type ApiErrorCode,
  type CreateLocalSyntheticUploadRequest,
  type LocalSyntheticUploadResponse,
  type PublicUpload,
} from "@studymix/contracts";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { fetchPrivateApi } from "./private-api";
import { isWebRequestInterruption } from "./request-timeout";

const localSyntheticUploadEnvelopeSchema = apiEnvelopeSchema(localSyntheticUploadResponseSchema);

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

function isResponseForRequest(
  response: LocalSyntheticUploadResponse,
  request: CreateLocalSyntheticUploadRequest,
): boolean {
  return (
    response.request.fixture === request.fixture &&
    response.request.idempotencyKey === request.idempotencyKey &&
    response.request.scenario === request.scenario
  );
}

function normalizeFetchError(error: unknown): never {
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

async function requestLocalSyntheticUpload(
  request: CreateLocalSyntheticUploadRequest,
  requestBody: string,
): Promise<PublicUpload> {
  try {
    const response = await fetchPrivateApi("/api/local/synthetic-upload", {
      body: requestBody,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    let body: unknown;
    try {
      body = await readBoundedWebJsonResponse(response);
    } catch (error) {
      if (isWebRequestInterruption(error)) {
        throw error;
      }
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
    if (!response.ok || !isResponseForRequest(parsed.data.data, request)) {
      throw invalidResponseError();
    }
    return parsed.data.data.upload;
  } catch (error) {
    normalizeFetchError(error);
  }
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

  const requestBody = JSON.stringify(parsedRequest.data);
  try {
    return await requestLocalSyntheticUpload(parsedRequest.data, requestBody);
  } catch (error) {
    if (!(error instanceof LocalAiApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestLocalSyntheticUpload(parsedRequest.data, requestBody);
  }
}
