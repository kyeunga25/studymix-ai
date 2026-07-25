import { z } from "zod";
import type {
  GenerationProviderResult,
  GenerationProviderStatus,
  GenerationSubmission,
  GenerationSubmissionResult,
  MusicGenerationProvider,
} from "./types";

const FAL_ENDPOINT = "fal-ai/ace-step/audio-to-audio" as const;
const FAL_STORE_IO_HEADER = "X-Fal-Store-IO" as const;

const falProviderRequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/);

const falSubmissionResponseSchema = z
  .object({
    request_id: falProviderRequestIdSchema,
    status: z.literal("IN_QUEUE"),
  })
  .passthrough();

const falStatusResponseSchema = z
  .object({
    error: z.string().max(4_096).nullish(),
    error_type: z.string().trim().min(1).max(128).nullish(),
    request_id: falProviderRequestIdSchema,
    status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
  })
  .passthrough();

const retryableFalErrorTypes = new Set([
  "internal_error",
  "request_timeout",
  "runner_connection_error",
  "runner_connection_refused",
  "runner_connection_timeout",
  "runner_disconnected",
  "runner_incomplete_response",
  "runner_scheduling_failure",
  "runner_server_error",
  "startup_timeout",
]);

const falResultResponseSchema = z
  .object({
    data: z
      .object({
        audio: z.object({
          content_type: z.string().trim().min(1).max(128).optional(),
          file_size: z.number().int().nonnegative().safe().optional(),
          url: z.string().trim().min(1).max(4_096),
        }),
        lyrics: z.string(),
        seed: z.number().int().safe(),
        tags: z.string(),
      })
      .passthrough(),
    requestId: falProviderRequestIdSchema,
  })
  .passthrough();

const httpsUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  }, "Expected a credential-free HTTPS URL.");

const falProviderBaseConfigSchema = z.object({
  outputExpirationSeconds: z.number().int().min(60).max(604_800),
  startTimeoutSeconds: z.number().int().min(1).max(3_600).optional(),
  webhookUrl: httpsUrlSchema.optional(),
});

export type FalAudioToAudioInput = Readonly<{
  audio_url: string;
  edit_mode: "remix";
  lyrics: "[inst]";
  original_lyrics: "";
  original_tags: string;
  tags: string;
}>;

export type FalQueueSubmitOptions = Readonly<{
  headers: Readonly<Record<string, string>>;
  input: FalAudioToAudioInput;
  outputExpirationSeconds: number;
  startTimeoutSeconds?: number;
  webhookUrl?: string;
}>;

export interface FalQueuePort {
  submit(options: FalQueueSubmitOptions): Promise<unknown>;
  status(providerRequestId: string): Promise<unknown>;
  result(providerRequestId: string): Promise<unknown>;
  cancel(providerRequestId: string): Promise<void>;
}

type FalProviderBaseConfig = Readonly<{
  outputExpirationSeconds: number;
  startTimeoutSeconds?: number;
  webhookUrl?: string;
}>;

export type FalProviderConfig =
  | (FalProviderBaseConfig &
      Readonly<{
        credentials: string;
        queue?: never;
      }>)
  | (FalProviderBaseConfig &
      Readonly<{
        credentials?: never;
        queue: FalQueuePort;
      }>);

function createSdkQueue(credentials: string): FalQueuePort {
  const parsedCredentials = z.string().trim().min(1).parse(credentials);

  const loadQueue = async () => {
    const { createFalClient } = await import("@fal-ai/client");
    return createFalClient({ credentials: parsedCredentials }).queue;
  };

  return {
    async cancel(providerRequestId) {
      const queue = await loadQueue();
      await queue.cancel(FAL_ENDPOINT, { requestId: providerRequestId });
    },
    async result(providerRequestId) {
      const queue = await loadQueue();
      return await queue.result(FAL_ENDPOINT, { requestId: providerRequestId });
    },
    async status(providerRequestId) {
      const queue = await loadQueue();
      return await queue.status(FAL_ENDPOINT, { logs: false, requestId: providerRequestId });
    },
    async submit(options) {
      const queue = await loadQueue();
      return await queue.submit(FAL_ENDPOINT, {
        headers: { ...options.headers },
        input: { ...options.input },
        storageSettings: { expiresIn: options.outputExpirationSeconds },
        ...(options.startTimeoutSeconds === undefined
          ? {}
          : { startTimeout: options.startTimeoutSeconds }),
        ...(options.webhookUrl === undefined ? {} : { webhookUrl: options.webhookUrl }),
      });
    },
  };
}

function parseFalOutputUrl(value: string): string {
  const parsed = new URL(httpsUrlSchema.parse(value));
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "fal.media" && !hostname.endsWith(".fal.media")) {
    throw new TypeError("The fal output URL host is not allowed.");
  }
  return parsed.href;
}

function assertMatchingRequestId(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new TypeError("The fal response request ID does not match the requested result.");
  }
}

function falErrorCode(errorType: string | null | undefined): string {
  if (errorType === null || errorType === undefined || !/^[a-z0-9_]+$/.test(errorType)) {
    return "FAL_PROVIDER_FAILED";
  }
  return `FAL_${errorType.toUpperCase()}`;
}

export class FalMusicGenerationProvider implements MusicGenerationProvider {
  readonly name = "fal" as const;

  readonly #outputExpirationSeconds: number;
  readonly #queue: FalQueuePort;
  readonly #startTimeoutSeconds: number | undefined;
  readonly #webhookUrl: string | undefined;

  constructor(config: FalProviderConfig) {
    const parsed = falProviderBaseConfigSchema.parse(config);
    this.#outputExpirationSeconds = parsed.outputExpirationSeconds;
    this.#startTimeoutSeconds = parsed.startTimeoutSeconds;
    this.#webhookUrl = parsed.webhookUrl;
    this.#queue = "queue" in config ? config.queue : createSdkQueue(config.credentials);
  }

  async submit(input: GenerationSubmission): Promise<GenerationSubmissionResult> {
    const sourceAudioUrl = httpsUrlSchema.parse(input.sourceAudioUrl);
    const targetTags = z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .parse(input.preset.providerParameters.targetTags);
    z.string().trim().min(1).max(256).parse(input.idempotencyKey);

    const mappedInput: FalAudioToAudioInput = {
      audio_url: sourceAudioUrl,
      edit_mode: input.preset.providerParameters.editMode,
      lyrics: input.preset.providerParameters.lyrics,
      original_lyrics: "",
      original_tags: targetTags,
      tags: targetTags,
    };
    const response = falSubmissionResponseSchema.parse(
      await this.#queue.submit({
        headers: { [FAL_STORE_IO_HEADER]: "0" },
        input: mappedInput,
        outputExpirationSeconds: this.#outputExpirationSeconds,
        ...(this.#startTimeoutSeconds === undefined
          ? {}
          : { startTimeoutSeconds: this.#startTimeoutSeconds }),
        ...(this.#webhookUrl === undefined ? {} : { webhookUrl: this.#webhookUrl }),
      }),
    );

    return { providerRequestId: response.request_id, status: "queued" };
  }

  async getStatus(providerRequestId: string): Promise<GenerationProviderStatus> {
    const parsedRequestId = falProviderRequestIdSchema.parse(providerRequestId);
    const response = falStatusResponseSchema.parse(await this.#queue.status(parsedRequestId));
    assertMatchingRequestId(parsedRequestId, response.request_id);

    if (
      (response.error !== null && response.error !== undefined) ||
      (response.error_type !== null && response.error_type !== undefined)
    ) {
      return {
        errorCode: falErrorCode(response.error_type),
        providerRequestId: parsedRequestId,
        retryable:
          response.error_type !== null &&
          response.error_type !== undefined &&
          retryableFalErrorTypes.has(response.error_type),
        status: "failed",
      };
    }

    const status =
      response.status === "IN_QUEUE"
        ? "queued"
        : response.status === "IN_PROGRESS"
          ? "generating"
          : "completed";
    return { providerRequestId: parsedRequestId, status };
  }

  async getResult(providerRequestId: string): Promise<GenerationProviderResult> {
    const parsedRequestId = falProviderRequestIdSchema.parse(providerRequestId);
    const response = falResultResponseSchema.parse(await this.#queue.result(parsedRequestId));
    assertMatchingRequestId(parsedRequestId, response.requestId);

    const providerMetadata: Record<string, string | number | boolean> = {};
    if (response.data.audio.content_type !== undefined) {
      providerMetadata.contentType = response.data.audio.content_type;
    }
    if (response.data.audio.file_size !== undefined) {
      providerMetadata.fileSize = response.data.audio.file_size;
    }

    return {
      outputUrl: parseFalOutputUrl(response.data.audio.url),
      providerRequestId: parsedRequestId,
      seed: response.data.seed,
      status: "completed",
      ...(Object.keys(providerMetadata).length === 0 ? {} : { providerMetadata }),
    };
  }

  async cancel(providerRequestId: string): Promise<void> {
    await this.#queue.cancel(falProviderRequestIdSchema.parse(providerRequestId));
  }
}
