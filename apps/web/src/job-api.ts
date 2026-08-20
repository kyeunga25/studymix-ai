import {
  apiEnvelopeSchema,
  createJobRequestSchema,
  deleteJobResponseSchema,
  downloadOutputResponseSchema,
  outputIdSchema,
  jobIdSchema,
  publicJobHistorySchema,
  publicJobSchema,
  type ApiErrorCode,
  type CreateJobRequest,
  type DownloadOutputResponse,
  type DeleteJobResponse,
  type PublicJob,
  type PublicJobHistory,
} from "@studymix/contracts";
import { readBoundedLocalAudioResponse } from "./bounded-local-audio-response";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { fetchPrivateApi } from "./private-api";
import { isTrustedR2PresignedUrl } from "./r2-instruction";
import { isWebRequestInterruption } from "./request-timeout";

const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const jobHistoryEnvelopeSchema = apiEnvelopeSchema(publicJobHistorySchema);
const downloadEnvelopeSchema = apiEnvelopeSchema(downloadOutputResponseSchema);
const deleteJobEnvelopeSchema = apiEnvelopeSchema(deleteJobResponseSchema);

export type OutputDownloadOptions = {
  allowLocalContent?: boolean;
  signal?: AbortSignal;
};

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

function invalidJobRequestError(): JobApiError {
  return new JobApiError({
    code: "VALIDATION_ERROR",
    message: "The job request is invalid.",
    retryable: false,
  });
}

function isJobForCreateRequest(job: PublicJob, request: CreateJobRequest): boolean {
  return (
    job.uploadId === request.uploadId &&
    job.preset.id === request.presetId &&
    job.preset.version === request.presetVersion &&
    job.candidateCount === request.candidateCount
  );
}

async function parseJobResponse(response: Response, requestedJobId?: string): Promise<PublicJob> {
  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
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
  if (!response.ok || (requestedJobId !== undefined && parsed.data.data.jobId !== requestedJobId)) {
    throw invalidResponseError();
  }
  return parsed.data.data;
}

async function parseJobHistoryResponse(response: Response): Promise<PublicJobHistory> {
  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
    throw invalidResponseError();
  }

  const parsed = jobHistoryEnvelopeSchema.safeParse(body);
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
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
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

function isTrustedOutputDownload(
  download: DownloadOutputResponse,
  requestedOutputId: string,
  allowLocalContent: boolean,
): boolean {
  if (download.outputId !== requestedOutputId) {
    return false;
  }
  if (download.downloadUrl.startsWith("/")) {
    return (
      allowLocalContent &&
      download.downloadUrl === `/api/local/outputs/${requestedOutputId}/content` &&
      Date.parse(download.expiresAt) > Date.now()
    );
  }
  return isTrustedR2PresignedUrl({
    expiresAt: download.expiresAt,
    kind: "output",
    resourceId: requestedOutputId,
    url: download.downloadUrl,
  });
}

function isLocalOutputContentPath(value: string): value is `/api/local/outputs/${string}/content` {
  return /^\/api\/local\/outputs\/out_[0-9a-f]{32}\/content$/.test(value);
}

async function parseDeleteJobResponse(
  response: Response,
  requestedJobId: string,
): Promise<DeleteJobResponse> {
  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
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
  if (!response.ok || parsed.data.data.jobId !== requestedJobId) {
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

async function requestJobCreation(request: CreateJobRequest): Promise<PublicJob> {
  try {
    const response = await fetchPrivateApi("/api/jobs", {
      body: JSON.stringify(request),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const job = await parseJobResponse(response);
    if (!isJobForCreateRequest(job, request)) {
      throw invalidResponseError();
    }
    return job;
  } catch (error) {
    normalizeFetchError(error);
  }
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
    return await requestJobCreation(parsedRequest.data);
  } catch (error) {
    if (
      parsedRequest.data.idempotencyKey === undefined ||
      !(error instanceof JobApiError && error.code === "NETWORK_ERROR")
    ) {
      throw error;
    }
    return await requestJobCreation(parsedRequest.data);
  }
}

async function requestJobRead(jobId: string, signal: AbortSignal): Promise<PublicJob> {
  try {
    const response = await fetchPrivateApi(`/api/jobs/${encodeURIComponent(jobId)}`, {
      signal,
    });
    return await parseJobResponse(response, jobId);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function getJob(jobId: string, signal: AbortSignal): Promise<PublicJob> {
  const parsedJobId = jobIdSchema.safeParse(jobId);
  if (!parsedJobId.success) {
    throw invalidJobRequestError();
  }
  try {
    return await requestJobRead(parsedJobId.data, signal);
  } catch (error) {
    if (!(error instanceof JobApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestJobRead(parsedJobId.data, signal);
  }
}

async function requestJobHistory(signal: AbortSignal): Promise<PublicJobHistory> {
  try {
    const response = await fetchPrivateApi("/api/jobs", { signal });
    return await parseJobHistoryResponse(response);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function getRecentJobs(signal: AbortSignal): Promise<PublicJobHistory> {
  try {
    return await requestJobHistory(signal);
  } catch (error) {
    if (!(error instanceof JobApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestJobHistory(signal);
  }
}

async function requestJobCancellation(jobId: string): Promise<PublicJob> {
  try {
    const response = await fetchPrivateApi(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
    });
    return await parseJobResponse(response, jobId);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function cancelJob(jobId: string): Promise<PublicJob> {
  const parsedJobId = jobIdSchema.safeParse(jobId);
  if (!parsedJobId.success) {
    throw invalidJobRequestError();
  }
  try {
    return await requestJobCancellation(parsedJobId.data);
  } catch (error) {
    if (!(error instanceof JobApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestJobCancellation(parsedJobId.data);
  }
}

async function requestJobDeletion(jobId: string): Promise<DeleteJobResponse> {
  try {
    const response = await fetchPrivateApi(`/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
    return await parseDeleteJobResponse(response, jobId);
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function deleteJob(jobId: string): Promise<DeleteJobResponse> {
  const parsedJobId = jobIdSchema.safeParse(jobId);
  if (!parsedJobId.success) {
    throw invalidJobRequestError();
  }
  try {
    return await requestJobDeletion(parsedJobId.data);
  } catch (error) {
    if (!(error instanceof JobApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestJobDeletion(parsedJobId.data);
  }
}

async function requestOutputDownload(
  outputId: string,
  options: OutputDownloadOptions,
): Promise<DownloadOutputResponse> {
  try {
    const response = await fetchPrivateApi(
      `/api/outputs/${encodeURIComponent(outputId)}/download`,
      {
        method: "POST",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    const download = await parseDownloadResponse(response);
    if (!isTrustedOutputDownload(download, outputId, options.allowLocalContent === true)) {
      throw invalidResponseError();
    }
    return download;
  } catch (error) {
    normalizeFetchError(error);
  }
}

export async function getOutputDownload(
  outputId: string,
  options: OutputDownloadOptions = {},
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
    return await requestOutputDownload(parsedOutputId.data, options);
  } catch (error) {
    if (!(error instanceof JobApiError && error.code === "NETWORK_ERROR")) {
      throw error;
    }
    return await requestOutputDownload(parsedOutputId.data, options);
  }
}

export async function getPlayableOutputSource(
  outputId: string,
  options: OutputDownloadOptions = {},
): Promise<string> {
  try {
    const download = await getOutputDownload(outputId, options);
    if (!isLocalOutputContentPath(download.downloadUrl)) {
      return download.downloadUrl;
    }

    const response = await fetchPrivateApi(download.downloadUrl, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    let audio: Blob;
    try {
      audio = await readBoundedLocalAudioResponse(response);
    } catch (error) {
      if (isWebRequestInterruption(error)) {
        throw error;
      }
      throw invalidResponseError();
    }
    options.signal?.throwIfAborted();
    return URL.createObjectURL(audio);
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
