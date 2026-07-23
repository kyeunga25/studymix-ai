import { describe, expect, it } from "vitest";
import { resolvePreset } from "@studymix/presets";
import type {
  GenerationProviderResult,
  GenerationProviderStatus,
  GenerationSubmission,
  GenerationSubmissionResult,
  MusicGenerationProvider,
} from "./types";

class FakeProvider implements MusicGenerationProvider {
  readonly name = "mock" as const;

  async submit(input: GenerationSubmission): Promise<GenerationSubmissionResult> {
    return Promise.resolve({
      providerRequestId: `${input.jobId}:${input.candidateIndex}`,
      status: "queued",
    });
  }

  async getStatus(providerRequestId: string): Promise<GenerationProviderStatus> {
    return Promise.resolve({ providerRequestId, status: "completed" });
  }

  async getResult(providerRequestId: string): Promise<GenerationProviderResult> {
    return Promise.resolve({
      providerRequestId,
      status: "completed",
      outputUrl: "https://provider.example.test/output.wav",
      providerMetadata: { modelRevision: "test", cached: true },
    });
  }

  async cancel(providerRequestId: string): Promise<void> {
    void providerRequestId;
    return Promise.resolve();
  }
}

describe("MusicGenerationProvider", () => {
  it("supports submission, status, result, and optional cancellation without a vendor SDK", async () => {
    const preset = resolvePreset("soft-piano", 1);
    expect(preset).toBeDefined();

    if (preset === undefined) {
      throw new Error("Expected the soft-piano v1 fixture.");
    }

    const provider = new FakeProvider();
    const submission = await provider.submit({
      jobId: "job_0123456789abcdef0123456789abcdef",
      candidateIndex: 0,
      sourceAudioUrl: "https://source.example.test/input.wav",
      preset,
      idempotencyKey: "candidate-request-001",
    });

    expect(submission).toEqual({
      providerRequestId: "job_0123456789abcdef0123456789abcdef:0",
      status: "queued",
    });
    await expect(provider.getStatus(submission.providerRequestId)).resolves.toEqual({
      providerRequestId: submission.providerRequestId,
      status: "completed",
    });
    await expect(provider.getResult(submission.providerRequestId)).resolves.toMatchObject({
      status: "completed",
      outputUrl: "https://provider.example.test/output.wav",
    });
    await expect(provider.cancel?.(submission.providerRequestId)).resolves.toBeUndefined();
  });
});
