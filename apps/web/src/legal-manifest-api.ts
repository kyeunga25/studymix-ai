import {
  apiEnvelopeSchema,
  legalDocumentsManifestSchema,
  type LegalDocumentsManifest,
} from "@studymix/contracts";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { isWebRequestInterruption, withWebJsonRequestTimeout } from "./request-timeout";

const legalManifestEnvelopeSchema = apiEnvelopeSchema(legalDocumentsManifestSchema);

export class LegalManifestApiError extends Error {
  override readonly name = "LegalManifestApiError";
}

async function requestLegalManifest(
  signal: AbortSignal,
  request: typeof fetch,
): Promise<LegalDocumentsManifest> {
  const response = await request("/legal/documents.json", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: withWebJsonRequestTimeout(signal),
  });
  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
    throw new LegalManifestApiError("The public legal manifest response is invalid.");
  }
  const parsed = legalManifestEnvelopeSchema.safeParse(body);
  if (!response.ok || !parsed.success || parsed.data.error !== null) {
    throw new LegalManifestApiError("The public legal manifest is unavailable.");
  }
  return parsed.data.data;
}

function normalizeLegalManifestError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error;
  }
  if (error instanceof LegalManifestApiError) {
    throw error;
  }
  throw new LegalManifestApiError("The public legal manifest is unavailable.");
}

export async function loadPublicLegalManifest(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<LegalDocumentsManifest> {
  try {
    return await requestLegalManifest(signal, request);
  } catch (error) {
    if (
      error instanceof LegalManifestApiError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    try {
      return await requestLegalManifest(signal, request);
    } catch (retryError) {
      normalizeLegalManifestError(retryError);
    }
  }
}
