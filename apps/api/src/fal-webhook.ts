import { z } from "zod";
import {
  GenerationWorkflowConfigurationError,
  GenerationWorkflowDisabledError,
  resolveGenerationWorkflowConfiguration,
} from "./job-service";
import { getFalWebhookTarget } from "./repositories";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  UnsupportedJsonMediaTypeError,
  readBoundedJsonResponse,
  readBoundedJsonWithBytes,
} from "./request-json";

const falJwksUrl = "https://rest.fal.ai/.well-known/jwks.json";
const maximumWebhookBytes = 131_072;
const maximumJwksBytes = 32_768;
const maximumTimestampSkewSeconds = 300;
export const falWebhookEventType = "fal-completion";

const providerRequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/);

const falWebhookBodySchema = z
  .object({
    request_id: providerRequestIdSchema,
    status: z.enum(["OK", "ERROR"]),
  })
  .passthrough();

const falPublicKeySchema = z
  .object({
    crv: z.literal("Ed25519"),
    kty: z.literal("OKP"),
    use: z.literal("sig").optional(),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}=?$/),
  })
  .passthrough();

const falJwksSchema = z
  .object({
    keys: z.array(falPublicKeySchema).min(1).max(16),
  })
  .passthrough();

type FalJwks = z.infer<typeof falJwksSchema>;

export type VerifiedFalWebhook = Readonly<{
  providerRequestId: string;
  status: "OK" | "ERROR";
}>;

export class FalWebhookAuthenticationError extends Error {
  override readonly name = "FalWebhookAuthenticationError";
}

export class FalWebhookInvalidRequestError extends Error {
  override readonly name = "FalWebhookInvalidRequestError";
}

export class FalWebhookVerificationUnavailableError extends Error {
  override readonly name = "FalWebhookVerificationUnavailableError";
}

type PreparedFalWebhook = VerifiedFalWebhook &
  Readonly<{
    message: Uint8Array;
    signature: Uint8Array;
  }>;

type FalWebhookDependencies = Readonly<{
  fetcher?: typeof fetch;
  nowMilliseconds?: number;
  sendSignal?: (
    workflowInstanceId: string,
    signal: Readonly<{ candidateIndex: 0 | 1; providerRequestId: string }>,
  ) => Promise<void>;
}>;

function webhookResponse(status: 202 | 400 | 401 | 404 | 413 | 415 | 503): Response {
  return new Response(null, { status });
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeHex(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]{128}$/.test(value)) {
    throw new FalWebhookAuthenticationError("The webhook signature is invalid.");
  }
  const bytes = new Uint8Array(64);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    bytes[index] = byte;
  }
  return bytes;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  if (bytes.byteLength !== 32) {
    throw new FalWebhookVerificationUnavailableError("The webhook public key is invalid.");
  }
  return bytes;
}

async function prepareFalWebhook(
  request: Request,
  expectedUserId: string,
  nowMilliseconds: number,
): Promise<PreparedFalWebhook> {
  const requestId = request.headers.get("X-Fal-Webhook-Request-Id");
  const userId = request.headers.get("X-Fal-Webhook-User-Id");
  const timestamp = request.headers.get("X-Fal-Webhook-Timestamp");
  const signature = request.headers.get("X-Fal-Webhook-Signature");
  const parsedRequestId = providerRequestIdSchema.safeParse(requestId);
  const parsedExpectedUserId = z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine((value) => !/\p{Cc}/u.test(value))
    .safeParse(expectedUserId);
  if (
    !parsedRequestId.success ||
    !parsedExpectedUserId.success ||
    userId !== parsedExpectedUserId.data ||
    timestamp === null ||
    !/^\d{1,12}$/.test(timestamp) ||
    signature === null
  ) {
    throw new FalWebhookAuthenticationError("The webhook authentication headers are invalid.");
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMilliseconds / 1_000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > maximumTimestampSkewSeconds
  ) {
    throw new FalWebhookAuthenticationError("The webhook timestamp is invalid.");
  }

  const body = await readBoundedJsonWithBytes(request, maximumWebhookBytes);
  const parsedBody = falWebhookBodySchema.safeParse(body.value);
  if (!parsedBody.success) {
    throw new FalWebhookInvalidRequestError("The webhook body is invalid.");
  }
  if (parsedBody.data.request_id !== parsedRequestId.data) {
    throw new FalWebhookAuthenticationError("The webhook request ID does not match the body.");
  }

  const bodyDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyToArrayBuffer(body.bytes)),
  );
  const message = new TextEncoder().encode(
    [parsedRequestId.data, parsedExpectedUserId.data, timestamp, toHex(bodyDigest)].join("\n"),
  );
  return {
    message,
    providerRequestId: parsedRequestId.data,
    signature: decodeHex(signature),
    status: parsedBody.data.status,
  };
}

async function fetchFalJwks(fetcher: typeof fetch): Promise<FalJwks> {
  let response: Response;
  try {
    response = await fetcher(falJwksUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new FalWebhookVerificationUnavailableError("The webhook public keys are unavailable.");
  }
  if (!response.ok) {
    throw new FalWebhookVerificationUnavailableError("The webhook public keys are unavailable.");
  }
  try {
    return falJwksSchema.parse(await readBoundedJsonResponse(response, maximumJwksBytes));
  } catch {
    throw new FalWebhookVerificationUnavailableError("The webhook public keys are invalid.");
  }
}

async function verifyPreparedFalWebhook(
  prepared: PreparedFalWebhook,
  jwks: FalJwks,
): Promise<VerifiedFalWebhook> {
  let importedKeyCount = 0;
  for (const key of jwks.keys) {
    try {
      const publicKey = await crypto.subtle.importKey(
        "raw",
        copyToArrayBuffer(decodeBase64Url(key.x)),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      importedKeyCount += 1;
      if (
        await crypto.subtle.verify(
          { name: "Ed25519" },
          publicKey,
          copyToArrayBuffer(prepared.signature),
          copyToArrayBuffer(prepared.message),
        )
      ) {
        return {
          providerRequestId: prepared.providerRequestId,
          status: prepared.status,
        };
      }
    } catch (error) {
      if (error instanceof FalWebhookVerificationUnavailableError) {
        throw error;
      }
    }
  }
  if (importedKeyCount === 0) {
    throw new FalWebhookVerificationUnavailableError("The webhook public keys cannot be used.");
  }
  throw new FalWebhookAuthenticationError("The webhook signature is invalid.");
}

export async function verifyFalWebhook(
  request: Request,
  expectedUserId: string,
  dependencies: Readonly<{ fetcher?: typeof fetch; nowMilliseconds?: number }> = {},
): Promise<VerifiedFalWebhook> {
  const prepared = await prepareFalWebhook(
    request,
    expectedUserId,
    dependencies.nowMilliseconds ?? Date.now(),
  );
  const jwks = await fetchFalJwks(dependencies.fetcher ?? fetch);
  return await verifyPreparedFalWebhook(prepared, jwks);
}

export async function handleFalWebhook(
  request: Request,
  env: Env,
  dependencies: FalWebhookDependencies = {},
): Promise<Response> {
  let configuration;
  try {
    configuration = resolveGenerationWorkflowConfiguration(env);
  } catch (error) {
    if (
      error instanceof GenerationWorkflowConfigurationError ||
      error instanceof GenerationWorkflowDisabledError
    ) {
      return webhookResponse(404);
    }
    return webhookResponse(503);
  }
  if (configuration.provider !== "fal") {
    return webhookResponse(404);
  }

  const expectedUrl = new URL(configuration.fal.webhookUrl);
  const requestUrl = new URL(request.url);
  if (
    requestUrl.origin !== expectedUrl.origin ||
    requestUrl.pathname !== expectedUrl.pathname ||
    requestUrl.search !== "" ||
    requestUrl.hash !== ""
  ) {
    return webhookResponse(404);
  }

  let verified: VerifiedFalWebhook;
  try {
    verified = await verifyFalWebhook(request, configuration.fal.webhookUserId, dependencies);
  } catch (error) {
    if (error instanceof UnsupportedJsonMediaTypeError) {
      return webhookResponse(415);
    }
    if (error instanceof JsonBodyTooLargeError) {
      return webhookResponse(413);
    }
    if (error instanceof InvalidJsonBodyError || error instanceof FalWebhookInvalidRequestError) {
      return webhookResponse(400);
    }
    if (error instanceof FalWebhookAuthenticationError) {
      return webhookResponse(401);
    }
    return webhookResponse(503);
  }

  let target;
  try {
    target = await getFalWebhookTarget(env.DB, verified.providerRequestId);
  } catch {
    return webhookResponse(503);
  }
  if (target === null) {
    return webhookResponse(404);
  }
  if (target.requestStatus !== "submitted" || target.jobStatus !== "generating") {
    return webhookResponse(202);
  }

  const sendSignal =
    dependencies.sendSignal ??
    (async (
      workflowInstanceId: string,
      signal: Readonly<{ candidateIndex: 0 | 1; providerRequestId: string }>,
    ) => {
      const instance = await env.GENERATION_WORKFLOW.get(workflowInstanceId);
      await instance.sendEvent({ payload: signal, type: falWebhookEventType });
    });
  try {
    await sendSignal(target.workflowInstanceId, {
      candidateIndex: target.candidateIndex,
      providerRequestId: verified.providerRequestId,
    });
  } catch {
    return webhookResponse(503);
  }
  return webhookResponse(202);
}
