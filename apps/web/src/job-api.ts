import {
  apiEnvelopeSchema,
  createJobRequestSchema,
  deleteJobResponseSchema,
  downloadOutputResponseSchema,
  outputIdSchema,
  jobIdSchema,
  publicJobSchema,
  type ApiErrorCode,
  type CreateJobRequest,
  type DownloadOutputResponse,
  type DeleteJobResponse,
  type PublicJob,
} from "@studymix/contracts";
import { fetchPrivateApi } from "./private-api";

const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const downloadEnvelopeSchema = apiEnvelopeSchema(downloadOutputResponseSchema);
const deleteJobEnvelopeSchema = apiEnvelopeSchema(deleteJobResponseSchema);

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

async function parseDownloadResponse(response: Response): Promise<DownloadOutputResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponseError();
  }
  const parsed = downloadEnvelopeSchema.safeParse(body);
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

async function parseDeleteJobResponse(response: Response): Promise<DeleteJobResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponseError();
  }
  const parsed = deleteJobEnvelopeSchema.safeParse(body);
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
    const response = await fetchPrivateApi("/api/jobs", {
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
    const response = await fetchPrivateApi(`/api/jobs/${encodeURIComponent(jobId)}`, {
      signal,
    });
    return await parseJobResponse(response);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function cancelJob(jobId: string): Promise<PublicJob> {
  const parsedJobId = jobIdSchema.safeParse(jobId);
  if (!parsedJobId.success) {
    throw new JobApiError({
      code: "VALIDATION_ERROR",
      message: "The job request is invalid.",
      retryable: false,
    });
  }
  try {
    const response = await fetchPrivateApi(
      `/api/jobs/${encodeURIComponent(parsedJobId.data)}/cancel`,
      {
        method: "POST",
      },
    );
    return await parseJobResponse(response);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function deleteJob(jobId: string): Promise<DeleteJobResponse> {
  const parsedJobId = jobIdSchema.safeParse(jobId);
  if (!parsedJobId.success) {
    throw new JobApiError({
      code: "VALIDATION_ERROR",
      message: "The job request is invalid.",
      retryable: false,
    });
  }
  try {
    const response = await fetchPrivateApi(`/api/jobs/${encodeURIComponent(parsedJobId.data)}`, {
      method: "DELETE",
    });
    return await parseDeleteJobResponse(response);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function getOutputDownload(
  outputId: string,
  signal?: AbortSignal,
): Promise<DownloadOutputResponse> {
  const parsedOutputId = outputIdSchema.safeParse(outputId);
  if (!parsedOutputId.success) {
    throw new JobApiError({
      code: "VALIDATION_ERROR",
      message: "The output request is invalid.",
      retryable: false,
    });
  }
  try {
    const response = await fetchPrivateApi(
      `/api/outputs/${encodeURIComponent(parsedOutputId.data)}/download`,
      {
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return await parseDownloadResponse(response);
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
