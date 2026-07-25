import { audioContentTypeSchema, type AudioContentType } from "@studymix/contracts";
import { z } from "zod";

const outputObjectKeySchema = z
  .string()
  .regex(/^owners\/own_[0-9a-f]{32}\/outputs\/out_[0-9a-f]{32}\/candidate$/);
const allowedHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const positiveBytesSchema = z.number().int().positive().safe();
const INGESTION_VERSION = "provider-v1" as const;

export type ProviderOutputIngestionErrorCode =
  | "INVALID_OUTPUT_URL"
  | "OUTPUT_FETCH_FAILED"
  | "OUTPUT_RESPONSE_INVALID"
  | "OUTPUT_TOO_LARGE"
  | "OUTPUT_STORAGE_FAILED"
  | "OUTPUT_METADATA_MISMATCH";

export class ProviderOutputIngestionError extends Error {
  readonly code: ProviderOutputIngestionErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderOutputIngestionErrorCode, retryable: boolean) {
    super("The provider output could not be stored safely.");
    this.name = "ProviderOutputIngestionError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ProviderOutputFetcher = (request: Request) => Promise<Response>;

export type IngestProviderOutputInput = Readonly<{
  allowedHosts: readonly string[];
  bucket: R2Bucket;
  expectedContentType?: string;
  expectedSizeBytes?: number;
  fetcher?: ProviderOutputFetcher;
  maxBytes: number;
  objectKey: string;
  outputUrl: string;
  timeoutMilliseconds: number;
}>;

export type IngestedProviderOutput = Readonly<{
  contentType: AudioContentType;
  sizeBytes: number;
}>;

function parseOutputUrl(value: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderOutputIngestionError("INVALID_OUTPUT_URL", false);
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !allowedHosts.some(
      (host) =>
        url.hostname.toLowerCase() === host || url.hostname.toLowerCase().endsWith(`.${host}`),
    )
  ) {
    throw new ProviderOutputIngestionError("INVALID_OUTPUT_URL", false);
  }
  return url;
}

function parseContentType(value: string | null): AudioContentType {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  const parsed = audioContentTypeSchema.safeParse(mediaType);
  if (!parsed.success) {
    throw new ProviderOutputIngestionError("OUTPUT_RESPONSE_INVALID", false);
  }
  return parsed.data;
}

function parseContentLength(value: string | null, maxBytes: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new ProviderOutputIngestionError("OUTPUT_RESPONSE_INVALID", false);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ProviderOutputIngestionError("OUTPUT_RESPONSE_INVALID", false);
  }
  if (parsed > maxBytes) {
    throw new ProviderOutputIngestionError("OUTPUT_TOO_LARGE", false);
  }
  return parsed;
}

function verifyStoredObject(
  object: R2Object,
  maxBytes: number,
  expectedContentType: AudioContentType | undefined,
  expectedSizeBytes: number | undefined,
): IngestedProviderOutput {
  let contentType: AudioContentType;
  try {
    contentType = parseContentType(object.httpMetadata?.contentType ?? null);
  } catch {
    throw new ProviderOutputIngestionError("OUTPUT_METADATA_MISMATCH", false);
  }
  if (
    object.size <= 0 ||
    object.size > maxBytes ||
    object.customMetadata?.ingestionVersion !== INGESTION_VERSION ||
    (expectedContentType !== undefined && contentType !== expectedContentType) ||
    (expectedSizeBytes !== undefined && object.size !== expectedSizeBytes)
  ) {
    throw new ProviderOutputIngestionError("OUTPUT_METADATA_MISMATCH", false);
  }
  return { contentType, sizeBytes: object.size };
}

export function createBoundedProviderOutputStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onBytesRead: (bytesRead: number) => void,
): ReadableStream<Uint8Array> {
  let bytesRead = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > maxBytes) {
          controller.error(new ProviderOutputIngestionError("OUTPUT_TOO_LARGE", false));
          return;
        }
        onBytesRead(bytesRead);
        controller.enqueue(chunk);
      },
    }),
  );
}

async function defaultFetcher(request: Request): Promise<Response> {
  return await fetch(request);
}

export async function ingestProviderOutput(
  input: IngestProviderOutputInput,
): Promise<IngestedProviderOutput> {
  const objectKey = outputObjectKeySchema.parse(input.objectKey);
  const maxBytes = positiveBytesSchema.max(524_288_000).parse(input.maxBytes);
  const timeoutMilliseconds = z
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .parse(input.timeoutMilliseconds);
  const allowedHosts = z.array(allowedHostSchema).min(1).max(8).parse(input.allowedHosts);
  const outputUrl = parseOutputUrl(input.outputUrl, allowedHosts);
  const expectedContentType =
    input.expectedContentType === undefined
      ? undefined
      : audioContentTypeSchema.parse(input.expectedContentType);
  const expectedSizeBytes =
    input.expectedSizeBytes === undefined
      ? undefined
      : positiveBytesSchema.max(maxBytes).parse(input.expectedSizeBytes);

  const existing = await input.bucket.head(objectKey);
  if (existing !== null) {
    return verifyStoredObject(existing, maxBytes, expectedContentType, expectedSizeBytes);
  }

  const request = new Request(outputUrl, {
    headers: {
      Accept: "audio/mpeg, audio/wav, audio/x-wav, audio/mp4, audio/aac, audio/ogg",
      "Accept-Encoding": "identity",
    },
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });

  let response: Response;
  try {
    response = await (input.fetcher ?? defaultFetcher)(request);
  } catch {
    throw new ProviderOutputIngestionError("OUTPUT_FETCH_FAILED", true);
  }

  let responseUrl: URL;
  try {
    responseUrl = response.url === "" ? outputUrl : parseOutputUrl(response.url, allowedHosts);
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  if (
    response.status !== 200 ||
    response.redirected ||
    responseUrl.href !== outputUrl.href ||
    response.body === null ||
    ![null, "identity"].includes(response.headers.get("content-encoding"))
  ) {
    await response.body?.cancel();
    throw new ProviderOutputIngestionError(
      "OUTPUT_RESPONSE_INVALID",
      response.status >= 500 || response.status === 429,
    );
  }

  let contentType: AudioContentType;
  let contentLength: number | undefined;
  try {
    contentType = parseContentType(response.headers.get("content-type"));
    contentLength = parseContentLength(response.headers.get("content-length"), maxBytes);
  } catch (error) {
    await response.body.cancel();
    throw error;
  }
  if (contentLength === undefined) {
    await response.body.cancel();
    throw new ProviderOutputIngestionError("OUTPUT_RESPONSE_INVALID", false);
  }
  if (
    (expectedContentType !== undefined && contentType !== expectedContentType) ||
    (expectedSizeBytes !== undefined && contentLength !== expectedSizeBytes)
  ) {
    await response.body.cancel();
    throw new ProviderOutputIngestionError("OUTPUT_METADATA_MISMATCH", false);
  }

  let bytesRead = 0;
  const boundedBody = createBoundedProviderOutputStream(response.body, maxBytes, (value) => {
    bytesRead = value;
  });
  const fixedLengthStream = new FixedLengthStream(contentLength);
  const pipeAbortController = new AbortController();
  const pipeOutcomePromise = boundedBody
    .pipeTo(fixedLengthStream.writable, { signal: pipeAbortController.signal })
    .then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => ({ reason, status: "rejected" as const }),
    );
  let created: R2Object | null;
  try {
    created = await input.bucket.put(objectKey, fixedLengthStream.readable, {
      customMetadata: { ingestionVersion: INGESTION_VERSION },
      httpMetadata: { contentType },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch {
    pipeAbortController.abort();
    const pipeOutcome = await pipeOutcomePromise;
    if (
      pipeOutcome.status === "rejected" &&
      pipeOutcome.reason instanceof ProviderOutputIngestionError
    ) {
      throw pipeOutcome.reason;
    }
    throw new ProviderOutputIngestionError("OUTPUT_STORAGE_FAILED", true);
  }
  if (created === null) {
    pipeAbortController.abort();
    await pipeOutcomePromise;
    const concurrentlyCreated = await input.bucket.head(objectKey);
    if (concurrentlyCreated === null) {
      throw new ProviderOutputIngestionError("OUTPUT_STORAGE_FAILED", true);
    }
    return verifyStoredObject(
      concurrentlyCreated,
      maxBytes,
      expectedContentType,
      expectedSizeBytes,
    );
  }

  const pipeOutcome = await pipeOutcomePromise;
  if (pipeOutcome.status === "rejected") {
    if (pipeOutcome.reason instanceof ProviderOutputIngestionError) {
      throw pipeOutcome.reason;
    }
    throw new ProviderOutputIngestionError("OUTPUT_METADATA_MISMATCH", false);
  }

  if (
    bytesRead === 0 ||
    created.size !== bytesRead ||
    created.size !== contentLength ||
    (expectedSizeBytes !== undefined && created.size !== expectedSizeBytes)
  ) {
    await input.bucket.delete(objectKey);
    throw new ProviderOutputIngestionError("OUTPUT_METADATA_MISMATCH", false);
  }

  return verifyStoredObject(created, maxBytes, expectedContentType, expectedSizeBytes);
}
