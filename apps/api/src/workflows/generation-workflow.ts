import { createSecureId } from "@studymix/core";
import { resolvePreset } from "@studymix/presets";
import {
  decodeMockAudioOutput,
  MockMusicGenerationProvider,
  type GenerationProviderResult,
} from "@studymix/providers";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { generationWorkflowPayloadSchema, type GenerationWorkflowPayload } from "../job-service";
import {
  createOutput,
  createProviderRequest,
  getOwnedJob,
  markOwnedOutputReady,
  markOwnedProviderRequestCompleted,
  markOwnedProviderRequestSubmitted,
  recordUsageEvent,
  transitionOwnedJob,
  type OutputRecord,
} from "../repositories";

const stepConfiguration = {
  retries: { backoff: "exponential", delay: "1 second", limit: 3 },
  timeout: "30 seconds",
} as const satisfies WorkflowStepConfig;

type CandidateResult = Readonly<{
  candidateIndex: 0 | 1;
  output: OutputRecord;
  providerResult: GenerationProviderResult;
}>;

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
    const provider = new MockMusicGenerationProvider();

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
      const preset = await step.do("resolve pinned preset", stepConfiguration, async () => {
        const resolved = resolvePreset(validatingJob.presetId, validatingJob.presetVersion);
        if (resolved === undefined) {
          throw new NonRetryableError("The pinned preset is unavailable.");
        }
        return resolved;
      });

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

      const candidateResults: CandidateResult[] = [];
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
              provider: "mock",
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
          stepConfiguration,
          async () =>
            await provider.submit({
              candidateIndex,
              idempotencyKey: resources.providerRequest.id,
              jobId: payload.jobId,
              preset,
              sourceAudioUrl: "https://mock.invalid/private-source",
            }),
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

        const providerStatus = await step.do(
          `check candidate ${candidateIndex.toString()} status`,
          stepConfiguration,
          async () => await provider.getStatus(submission.providerRequestId),
        );
        if (providerStatus.status !== "completed") {
          throw new Error("Mock generation did not complete.");
        }
        const providerResult = await step.do(
          `read candidate ${candidateIndex.toString()} result`,
          stepConfiguration,
          async () => await provider.getResult(submission.providerRequestId),
        );
        candidateResults.push({ candidateIndex, output: resources.output, providerResult });
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

      for (const candidate of candidateResults) {
        const stored = await step.do(
          `store candidate ${candidate.candidateIndex.toString()}`,
          stepConfiguration,
          async () => {
            const audio = decodeMockAudioOutput(candidate.providerResult.outputUrl);
            const created = await this.env.AUDIO_BUCKET.put(
              candidate.output.objectKey,
              audio.body,
              {
                customMetadata: {
                  mockCandidate: candidate.candidateIndex.toString(),
                  mockVersion: "v1",
                },
                httpMetadata: { contentType: audio.contentType },
                onlyIf: { etagDoesNotMatch: "*" },
              },
            );
            const object =
              created ?? (await this.env.AUDIO_BUCKET.head(candidate.output.objectKey));
            if (
              object === null ||
              object.size !== audio.body.byteLength ||
              object.httpMetadata?.contentType !== audio.contentType ||
              object.customMetadata?.mockCandidate !== candidate.candidateIndex.toString() ||
              object.customMetadata?.mockVersion !== "v1"
            ) {
              throw new Error("Private mock output could not be verified.");
            }
            return {
              contentType: audio.contentType,
              durationSeconds: audio.durationSeconds,
              sizeBytes: audio.body.byteLength,
            };
          },
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
              providerRequestId: candidate.providerResult.providerRequestId,
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

      await step.do("record mock generation usage", stepConfiguration, async () => {
        await recordUsageEvent(this.env.DB, {
          createdAt: new Date().toISOString(),
          estimatedCostUsd: 0,
          eventType: "mock_generation_candidates",
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
                errorCode: "MOCK_WORKFLOW_FAILED",
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
