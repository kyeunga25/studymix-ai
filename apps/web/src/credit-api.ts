import { apiEnvelopeSchema, creditSummarySchema, type CreditSummary } from "@studymix/contracts";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { fetchPrivateApi } from "./private-api";
import { isWebRequestInterruption } from "./request-timeout";

const creditSummaryEnvelopeSchema = apiEnvelopeSchema(creditSummarySchema);

export class CreditApiError extends Error {
  override readonly name = "CreditApiError";
}

async function requestCreditSummary(
  signal: AbortSignal,
  request: typeof fetch,
): Promise<CreditSummary> {
  const response = await fetchPrivateApi(
    "/api/credits",
    {
      headers: { Accept: "application/json" },
      signal,
    },
    request,
  );
  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
    throw new CreditApiError("The private beta credit response is invalid.");
  }
  const parsed = creditSummaryEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new CreditApiError("The private beta credit response is invalid.");
  }
  if (!response.ok || parsed.data.error !== null) {
    throw new CreditApiError("The private beta credit balance is unavailable.");
  }
  return parsed.data.data;
}

function normalizeCreditRequestError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error;
  }
  if (error instanceof CreditApiError) {
    throw error;
  }
  throw new CreditApiError("The private beta credit balance is unavailable.");
}

export async function getCreditSummary(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<CreditSummary> {
  try {
    return await requestCreditSummary(signal, request);
  } catch (error) {
    if (
      error instanceof CreditApiError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    try {
      return await requestCreditSummary(signal, request);
    } catch (retryError) {
      normalizeCreditRequestError(retryError);
    }
  }
}
