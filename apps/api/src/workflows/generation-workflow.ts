import { audioContentTypeSchema } from "@studymix/contracts";
import { createSecureId } from "@studymix/core";
import { resolvePreset } from "@studymix/presets";
import {
  createMusicGenerationProvider,
  decodeMockAudioOutput,
  type GenerationProviderResult,
  type MusicGenerationProvider,
} from "@studymix/providers";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { falWebhookEventType } from "../fal-webhook";
import {
  generationWorkflowPayloadSchema,
  resolveGenerationWorkflowConfiguration,
  type GenerationWorkflowConfiguration,
  type GenerationWorkflowPayload,
} from "../job-service";
import { ProviderOutputIngestionError, ingestProviderOutput } from "../provider-output-ingestion";
import {
  createOutput,
  createProviderRequest,
  getOwnedJob,
  getOwnedUpload,
  markOwnedOutputReady,
  markOwnedProviderRequestCompleted,
  markOwnedProviderRequestSubmitted,
  recordUsageEvent,
  transitionOwnedJob,
  type OutputRecord,
} from "../repositories";
import { createSignedR2ObjectUrl } from "../r2-transfer";

const stepConfiguration = {
  retries: { backoff: "exponential", delay: "1 second", limit: 3 },
  timeout: "30 seconds",
} as const satisfies WorkflowStepConfig;

const submissionStepConfiguration = {
  retries: { backoff: "constant", delay: "1 second", limit: 2 },
  sensitive: "output",
  timeout: "1 minute",
} as const satisfies WorkflowStepConfig;

const outputStepConfiguration = {
  retries: { backoff: "exponential", delay: "2 seconds", limit: 3 },
  timeout: "3 minutes",
} as const satisfies WorkflowStepConfig;

type PreparedCandidate = Readonly<{
  candidateIndex: 0 | 1;
  output: OutputRecord;
  providerRequestId: string;
}>;

type PrivateSource = Readonly<{
  contentType: string;
  objectKey: string;
  sizeBytes: number;
}>;

type StoredCandidate = Readonly<{
  contentType: string;
  durationSeconds: number | null;
  providerRequestId: string;
  seed?: number;
  sizeBytes: number;
}>;

export function ensureFirstProviderSubmissionAttempt(attempt: number): void {
  if (attempt !== 1) {
    throw new NonRetryableError(
      "Provider submission outcome is ambiguous; a duplicate request was not sent.",
    );
  }
}

function createProvider(configuration: GenerationWorkflowConfiguration): MusicGenerationProvider {
  if (configuration.provider === "mock") {
    return createMusicGenerationProvider({ provider: "mock" });
  }
  return createMusicGenerationProvider({
    config: {
      credentials: configuration.fal.credentials,
      outputExpirationSeconds: configuration.fal.outputExpirationSeconds,
      startTimeoutSeconds: configuration.fal.queueStartTimeoutSeconds,
      webhookUrl: configuration.fal.webhookUrl,
    },
    provider: "fal",
  });
}

async function waitForProviderCompletion({
  candidateIndex,
  configuration,
  provider,
  providerRequestId,
  step,
}: {
  candidateIndex: 0 | 1;
  configuration: GenerationWorkflowConfiguration;
  provider: MusicGenerationProvider;
  providerRequestId: string;
  step: WorkflowStep;
}): Promise<void> {
  const maxPollAttempts = configuration.provider === "fal" ? configuration.fal.maxPollAttempts : 1;
  const pollIntervalMilliseconds =
    configuration.provider === "fal" ? configuration.fal.pollIntervalMilliseconds : 0;

  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const status = await step.do(
      `poll candidate ${candidateIndex.toString()} attempt ${attempt.toString()}`,
      stepConfiguration,
      async () => await provider.getStatus(providerRequestId),
    );
    if (status.status === "completed") {
      return;
    }
    if (status.status === "failed") {
      throw new NonRetryableError("The provider request did not complete successfully.");
    }
    if (attempt < maxPollAttempts) {
      if (configuration.provider === "fal") {
        try {
          await step.waitForEvent(
            `wait for candidate ${candidateIndex.toString()} signal attempt ${attempt.toString()}`,
            { timeout: pollIntervalMilliseconds, type: falWebhookEventType },
          );
        } catch {
          // Polling remains the source of truth when no callback signal arrives.
        }
      } else {
        await step.sleep(
          `wait candidate ${candidateIndex.toString()} attempt ${attempt.toString()}`,
          pollIntervalMilliseconds,
        );
      }
    }
  }
  throw new NonRetryableError("The provider request exceeded the polling limit.");
}

async function storeMockOutput(
  bucket: R2Bucket,
  candidateIndex: 0 | 1,
  output: OutputRecord,
  providerResult: GenerationProviderResult,
): Promise<StoredCandidate> {
  const audio = decodeMockAudioOutput(providerResult.outputUrl);
  const created = await bucket.put(output.objectKey, audio.body, {
    customMetadata: {
      mockCandidate: candidateIndex.toString(),
      mockVersion: "v1",
    },
    httpMetadata: { contentType: audio.contentType },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  const object = created ?? (await bucket.head(output.objectKey));
  if (
    object === null ||
    object.size !== audio.body.byteLength ||
    object.httpMetadata?.contentType !== audio.contentType ||
    object.customMetadata?.mockCandidate !== candidateIndex.toString() ||
    object.customMetadata?.mockVersion !== "v1"
  ) {
    throw new NonRetryableError("Private mock output could not be verified.");
  }
  return {
    contentType: audio.contentType,
    durationSeconds: audio.durationSeconds,
    providerRequestId: providerResult.providerRequestId,
    sizeBytes: audio.body.byteLength,
  };
}

async function storeFalOutput(
  bucket: R2Bucket,
  configuration: Extract<GenerationWorkflowConfiguration, { provider: "fal" }>,
  output: OutputRecord,
  providerResult: GenerationProviderResult,
): Promise<StoredCandidate> {
  const metadataContentType = providerResult.providerMetadata?.contentType;
  const metadataFileSize = providerResult.providerMetadata?.fileSize;
  try {
    const stored = await ingestProviderOutput({
      allowedHosts: ["fal.media"],
      bucket,
      ...(typeof metadataContentType === "string"
        ? { expectedContentType: metadataContentType }
        : {}),
      ...(typeof metadataFileSize === "number" ? { expectedSizeBytes: metadataFileSize } : {}),
      maxBytes: configuration.fal.maxOutputBytes,
      objectKey: output.objectKey,
      outputUrl: providerResult.outputUrl,
      timeoutMilliseconds: configuration.fal.outputTimeoutMilliseconds,
    });
    return {
      contentType: stored.contentType,
      durationSeconds: providerResult.durationSeconds ?? null,
      providerRequestId: providerResult.providerRequestId,
      ...(providerResult.seed === undefined ? {} : { seed: providerResult.seed }),
      sizeBytes: stored.sizeBytes,
    };
  } catch (error) {
    if (error instanceof ProviderOutputIngestionError && !error.retryable) {
      throw new NonRetryableError("The provider output failed private-ingestion validation.");
    }
    throw error;
  }
}

async function storeCandidateOutput(
  bucket: R2Bucket,
  candidate: PreparedCandidate,
  configuration: GenerationWorkflowConfiguration,
  provider: MusicGenerationProvider,
): Promise<StoredCandidate> {
  const providerResult = await provider.getResult(candidate.providerRequestId);
  if (configuration.provider === "mock") {
    return await storeMockOutput(
      bucket,
      candidate.candidateIndex,
      candidate.output,
      providerResult,
    );
  }
  return await storeFalOutput(bucket, configuration, candidate.output, providerResult);
}

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationWorkflowPayload> {
  override async run(
    event: Readonly<WorkflowEvent<GenerationWorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<{ jobId: string; status: "completed" | "failed" }> {
    const parsedPayload = generationWorkflowPayloadSchema.safeParse(event.payload);
    if (!parsedPayload.success) {
      throw new NonRetryableError("Generation Workflow payload is invalid.");
    }
    const payload = parsedPayload.data;

    const validatingJob = await step.do(
      "mark job validating",
      stepConfiguration,
      async () =>
        await transitionOwnedJob(
          this.env.DB,
          payload.ownerId,
          payload.jobId,
          ["created"],
          "validating",
          {
            completedAt: null,
            errorCode: null,
            updatedAt: new Date().toISOString(),
          },
        ),
    );

    try {
      const configuration = resolveGenerationWorkflowConfiguration(this.env);
      if (configuration.provider !== validatingJob.provider) {
        throw new NonRetryableError("The pinned generation provider is unavailable.");
      }
      const provider = createProvider(configuration);
      const preset = await step.do("resolve pinned preset", stepConfiguration, async () => {
        const resolved = resolvePreset(validatingJob.presetId, validatingJob.presetVersion);
        if (resolved === undefined) {
          throw new NonRetryableError("The pinned preset is unavailable.");
        }
        return resolved;
      });

      const privateSource: PrivateSource | null =
        configuration.provider === "fal"
          ? await step.do("verify private source", stepConfiguration, async () => {
              const upload = await getOwnedUpload(
                this.env.DB,
                payload.ownerId,
                validatingJob.uploadId,
              );
              if (
                upload === null ||
                upload.status !== "confirmed" ||
                upload.sizeBytes === null ||
                new Date(upload.expiresAt).getTime() <= Date.now()
              ) {
                throw new NonRetryableError("The confirmed private source is unavailable.");
              }
              const contentType = audioContentTypeSchema.parse(upload.declaredContentType);
              const object = await this.env.AUDIO_BUCKET.head(upload.objectKey);
              if (
                object === null ||
                object.size !== upload.sizeBytes ||
                object.httpMetadata?.contentType !== contentType
              ) {
                throw new NonRetryableError("The private source metadata could not be verified.");
              }
              return {
                contentType,
                objectKey: upload.objectKey,
                sizeBytes: upload.sizeBytes,
              };
            })
          : null;

      await step.do(
        "mark job queued",
        stepConfiguration,
        async () =>
          await transitionOwnedJob(
            this.env.DB,
            payload.ownerId,
            payload.jobId,
            ["validating"],
            "queued",
            {
              completedAt: null,
              errorCode: null,
              updatedAt: new Date().toISOString(),
            },
          ),
      );
      await step.do(
        "mark job generating",
        stepConfiguration,
        async () =>
          await transitionOwnedJob(
            this.env.DB,
            payload.ownerId,
            payload.jobId,
            ["queued"],
            "generating",
            {
              completedAt: null,
              errorCode: null,
              updatedAt: new Date().toISOString(),
            },
          ),
      );

      const preparedCandidates: PreparedCandidate[] = [];
      for (const candidateIndex of [0, 1] as const) {
        const resources = await step.do(
          `prepare candidate ${candidateIndex.toString()}`,
          stepConfiguration,
          async () => {
            const providerRequest = await createProviderRequest(this.env.DB, {
              candidateIndex,
              id: createSecureId("req"),
              jobId: payload.jobId,
              ownerId: payload.ownerId,
              provider: configuration.provider,
            });
            const outputId = createSecureId("out");
            const output = await createOutput(this.env.DB, {
              candidateIndex,
              createdAt: validatingJob.createdAt,
              expiresAt: validatingJob.expiresAt,
              id: outputId,
              jobId: payload.jobId,
              objectKey: `owners/${payload.ownerId}/outputs/${outputId}/candidate`,
              ownerId: payload.ownerId,
            });
            return { output, providerRequest };
          },
        );

        const submission = await step.do(
          `submit candidate ${candidateIndex.toString()}`,
          submissionStepConfiguration,
          async (context) => {
            ensureFirstProviderSubmissionAttempt(context.attempt);
            let sourceAudioUrl = "https://mock.invalid/private-source";
            if (configuration.provider === "fal") {
              if (privateSource === null) {
                throw new NonRetryableError("The private source is unavailable.");
              }
              const signedSource = await createSignedR2ObjectUrl({
                configuration: configuration.fal.r2,
                method: "GET",
                now: new Date(),
                objectKey: privateSource.objectKey,
              });
              sourceAudioUrl = signedSource.url;
            }
            try {
              return await provider.submit({
                candidateIndex,
                idempotencyKey: resources.providerRequest.id,
                jobId: payload.jobId,
                preset,
                sourceAudioUrl,
              });
            } catch {
              throw new NonRetryableError(
                "The provider submission failed without a retryable result.",
              );
            }
          },
        );
        await step.do(
          `record candidate ${candidateIndex.toString()} submission`,
          stepConfiguration,
          async () =>
            await markOwnedProviderRequestSubmitted(this.env.DB, {
              candidateIndex,
              jobId: payload.jobId,
              ownerId: payload.ownerId,
              providerRequestId: submission.providerRequestId,
              submittedAt: new Date().toISOString(),
            }),
        );

        await waitForProviderCompletion({
          candidateIndex,
          configuration,
          provider,
          providerRequestId: submission.providerRequestId,
          step,
        });
        preparedCandidates.push({
          candidateIndex,
          output: resources.output,
          providerRequestId: submission.providerRequestId,
        });
      }

      await step.do(
        "mark job processing output",
        stepConfiguration,
        async () =>
          await transitionOwnedJob(
            this.env.DB,
            payload.ownerId,
            payload.jobId,
            ["generating"],
            "processing_output",
            {
              completedAt: null,
              errorCode: null,
              updatedAt: new Date().toISOString(),
            },
          ),
      );

      for (const candidate of preparedCandidates) {
        const stored = await step.do(
          `store candidate ${candidate.candidateIndex.toString()}`,
          outputStepConfiguration,
          async () =>
            await storeCandidateOutput(this.env.AUDIO_BUCKET, candidate, configuration, provider),
        );
        await step.do(
          `complete candidate ${candidate.candidateIndex.toString()} provider request`,
          stepConfiguration,
          async () =>
            await markOwnedProviderRequestCompleted(this.env.DB, {
              candidateIndex: candidate.candidateIndex,
              completedAt: new Date().toISOString(),
              jobId: payload.jobId,
              ownerId: payload.ownerId,
              providerRequestId: stored.providerRequestId,
              ...(stored.seed === undefined ? {} : { seed: stored.seed }),
            }),
        );
        await step.do(
          `mark candidate ${candidate.candidateIndex.toString()} ready`,
          stepConfiguration,
          async () =>
            await markOwnedOutputReady(this.env.DB, {
              candidateIndex: candidate.candidateIndex,
              contentType: stored.contentType,
              durationSeconds: stored.durationSeconds,
              jobId: payload.jobId,
              ownerId: payload.ownerId,
              sizeBytes: stored.sizeBytes,
            }),
        );
      }

      await step.do("record generation usage", stepConfiguration, async () => {
        await recordUsageEvent(this.env.DB, {
          createdAt: new Date().toISOString(),
          estimatedCostUsd: configuration.provider === "mock" ? 0 : null,
          eventType:
            configuration.provider === "mock"
              ? "mock_generation_candidates"
              : "fal_generation_candidates",
          id: `evt_${payload.jobId.slice(4)}`,
          jobId: payload.jobId,
          ownerId: payload.ownerId,
          quantity: 2,
        });
        return { recorded: true };
      });
      await step.do("mark job completed", stepConfiguration, async () => {
        const completedAt = new Date().toISOString();
        return await transitionOwnedJob(
          this.env.DB,
          payload.ownerId,
          payload.jobId,
          ["processing_output"],
          "completed",
          { completedAt, errorCode: null, updatedAt: completedAt },
        );
      });
      return { jobId: payload.jobId, status: "completed" };
    } catch {
      await step.do("mark job failed", stepConfiguration, async () => {
        const current = await getOwnedJob(this.env.DB, payload.ownerId, payload.jobId);
        if (current === null) {
          throw new Error("Owned job is unavailable.");
        }
        switch (current.status) {
          case "validating":
          case "queued":
          case "generating":
          case "processing_output": {
            const failedAt = new Date().toISOString();
            return await transitionOwnedJob(
              this.env.DB,
              payload.ownerId,
              payload.jobId,
              [current.status],
              "failed",
              {
                completedAt: failedAt,
                errorCode:
                  validatingJob.provider === "mock"
                    ? "MOCK_WORKFLOW_FAILED"
                    : "PROVIDER_WORKFLOW_FAILED",
                updatedAt: failedAt,
              },
            );
          }
          default:
            return current;
        }
      });
      return { jobId: payload.jobId, status: "failed" };
    }
  }
}
