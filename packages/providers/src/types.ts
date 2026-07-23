import type { CandidateIndex } from "@studymix/contracts";
import type { ResolvedStylePreset } from "@studymix/presets";

export type MusicGenerationProviderName = "mock" | "fal" | "self-hosted";

export type GenerationSubmission = Readonly<{
  jobId: string;
  candidateIndex: CandidateIndex;
  sourceAudioUrl: string;
  preset: ResolvedStylePreset;
  idempotencyKey: string;
}>;

export type GenerationSubmissionResult = Readonly<{
  providerRequestId: string;
  status: "queued" | "generating";
}>;

export type GenerationProviderStatus =
  | Readonly<{
      providerRequestId: string;
      status: "queued" | "generating" | "completed";
    }>
  | Readonly<{
      providerRequestId: string;
      status: "failed";
      errorCode: string;
      retryable: boolean;
    }>;

export type GenerationProviderResult = Readonly<{
  providerRequestId: string;
  status: "completed";
  outputUrl: string;
  seed?: number;
  durationSeconds?: number;
  providerMetadata?: Readonly<Record<string, string | number | boolean>>;
}>;

export interface MusicGenerationProvider {
  readonly name: MusicGenerationProviderName;

  submit(input: GenerationSubmission): Promise<GenerationSubmissionResult>;

  getStatus(providerRequestId: string): Promise<GenerationProviderStatus>;

  getResult(providerRequestId: string): Promise<GenerationProviderResult>;

  cancel?(providerRequestId: string): Promise<void>;
}
