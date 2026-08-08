import { apiEnvelopeSchema, creditSummarySchema, type CreditSummary } from "@studymix/contracts";
import { fetchPrivateApi } from "./private-api";

const creditSummaryEnvelopeSchema = apiEnvelopeSchema(creditSummarySchema);

export class CreditApiError extends Error {
  override readonly name = "CreditApiError";
}

export async function getCreditSummary(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<CreditSummary> {
  const response = await fetchPrivateApi(
    "/api/credits",
    {
      headers: { Accept: "application/json" },
      signal,
    },
    request,
  );
  const body: unknown = await response.json();
  const parsed = creditSummaryEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new CreditApiError("The private beta credit response is invalid.");
  }
  if (!response.ok || parsed.data.error !== null) {
    throw new CreditApiError("The private beta credit balance is unavailable.");
  }
  return parsed.data.data;
}
