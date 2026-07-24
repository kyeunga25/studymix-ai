import {
  apiEnvelopeSchema,
  createJobRequestSchema,
  publicJobSchema,
  type ApiErrorCode,
  type CreateJobRequest,
  type PublicJob,
} from "@studymix/contracts";

const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);

export class JobApiError extends Error {
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
    this.name = "JobApiError";
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

function invalidResponseError(): JobApiError {
  return new JobApiError({
    code: "INVALID_RESPONSE",
    message: "The job service returned an invalid response.",
    retryable: true,
  });
}

async function parseJobResponse(response: Response): Promise<PublicJob> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponseError();
  }

  const parsed = jobEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw invalidResponseError();
  }
  if (parsed.data.error !== null) {
    throw new JobApiError({
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
  if (error instanceof JobApiError) {
    throw error;
  }
  throw new JobApiError({
    code: "NETWORK_ERROR",
    message: "The job service could not be reached.",
    retryable: true,
  });
}

export async function createJob(request: CreateJobRequest): Promise<PublicJob> {
  const parsedRequest = createJobRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new JobApiError({
      code: "VALIDATION_ERROR",
      message: "The job request is invalid.",
      retryable: false,
    });
  }

  try {
    const response = await fetch("/api/jobs", {
      body: JSON.stringify(parsedRequest.data),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return await parseJobResponse(response);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function getJob(jobId: string, signal: AbortSignal): Promise<PublicJob> {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      credentials: "same-origin",
      signal,
    });
    return await parseJobResponse(response);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export function toJobApiError(error: unknown): JobApiError {
  if (error instanceof JobApiError) {
    return error;
  }
  return new JobApiError({
    code: "NETWORK_ERROR",
    message: "The job service could not be reached.",
    retryable: true,
  });
}
