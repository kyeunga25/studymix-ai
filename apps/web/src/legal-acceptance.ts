import {
  apiEnvelopeSchema,
  currentLegalAcceptanceDocuments,
  legalAcceptanceStatusSchema,
  type ApiErrorCode,
  type LegalAcceptanceStatus,
} from "@studymix/contracts";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { fetchPrivateApi } from "./private-api";
import { isWebRequestInterruption } from "./request-timeout";

const legalAcceptanceEnvelopeSchema = apiEnvelopeSchema(legalAcceptanceStatusSchema);

export class LegalAcceptanceApiError extends Error {
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
    this.name = "LegalAcceptanceApiError";
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

export function isVerifiedCurrentLegalAcceptance(status: LegalAcceptanceStatus): boolean {
  return (
    status.current &&
    currentLegalAcceptanceDocuments.every(
      (currentDocument) =>
        status.acceptedAt[currentDocument.documentId] !== null &&
        status.requiredDocuments.some(
          (requiredDocument) =>
            requiredDocument.documentId === currentDocument.documentId &&
            requiredDocument.version === currentDocument.version,
        ),
    )
  );
}

function invalidResponseError(): LegalAcceptanceApiError {
  return new LegalAcceptanceApiError({
    code: "INVALID_RESPONSE",
    message: "The legal acceptance service returned an invalid response.",
    retryable: true,
  });
}

function normalizeFetchError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error;
  }
  if (error instanceof LegalAcceptanceApiError) {
    throw error;
  }
  throw new LegalAcceptanceApiError({
    code: "NETWORK_ERROR",
    message: "The legal acceptance service could not be reached.",
    retryable: true,
  });
}

async function requestCurrentLegalAcceptance(
  requestBody: string,
  signal?: AbortSignal,
): Promise<LegalAcceptanceStatus> {
  try {
    const response = await fetchPrivateApi("/api/legal/acceptances", {
      body: requestBody,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
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
    const parsed = legalAcceptanceEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponseError();
    }
    if (parsed.data.error !== null) {
      throw new LegalAcceptanceApiError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        requestId: parsed.data.requestId,
        retryable: parsed.data.error.retryable,
      });
    }
    if (!response.ok || !isVerifiedCurrentLegalAcceptance(parsed.data.data)) {
      throw invalidResponseError();
    }
    return parsed.data.data;
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function saveCurrentLegalAcceptance(
  signal?: AbortSignal,
): Promise<LegalAcceptanceStatus> {
  const requestBody = JSON.stringify({ documents: currentLegalAcceptanceDocuments });
  try {
    return await requestCurrentLegalAcceptance(requestBody, signal);
  } catch (error) {
    if (!(error instanceof LegalAcceptanceApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestCurrentLegalAcceptance(requestBody, signal);
  }
}
