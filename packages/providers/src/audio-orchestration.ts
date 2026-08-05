import {
  audioContentTypeSchema,
  candidateIndexSchema,
  localAiScenarioSchema,
  presetReferenceSchema,
  type CandidateIndex,
  type LocalAiScenario,
} from "@studymix/contracts";
import { z } from "zod";

const pseudonymousCorrelationIdSchema = z.string().regex(/^ctx_[0-9a-f]{32}$/);
const orchestrationAttemptIdSchema = z.string().regex(/^att_[0-9a-f]{32}$/);

export const audioOrchestrationPolicySchema = z
  .object({
    candidateCount: z.literal(2),
    maxAttemptsPerCandidate: z.number().int().min(1).max(8),
    maxConcurrentCandidates: z.number().int().min(1).max(2),
    maxCostUnits: z.number().int().positive().max(100),
    maxInputDurationSeconds: z.number().positive().max(3_600),
    maxOutputBytes: z.number().int().positive().safe(),
    maxOutputDurationSeconds: z.number().positive().max(3_600),
    qualityTier: z.literal("synthetic-preview"),
    retentionSeconds: z.number().int().positive().max(2_592_000),
  })
  .strict();

export const audioOrchestrationContextSchema = z
  .object({
    candidateIndex: candidateIndexSchema,
    correlationId: pseudonymousCorrelationIdSchema,
    policy: audioOrchestrationPolicySchema,
    preset: presetReferenceSchema,
    scenario: localAiScenarioSchema,
    source: z
      .object({
        contentType: audioContentTypeSchema,
        durationSeconds: z.number().positive().finite(),
        sizeBytes: z.number().int().positive().safe(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source.durationSeconds > value.policy.maxInputDurationSeconds) {
      context.addIssue({
        code: "custom",
        message: "Input duration exceeds the orchestration policy.",
        path: ["source", "durationSeconds"],
      });
    }
    if (value.candidateIndex >= value.policy.candidateCount) {
      context.addIssue({
        code: "custom",
        message: "Candidate index exceeds the orchestration policy.",
        path: ["candidateIndex"],
      });
    }
  });

const orchestrationPollSchema = z
  .object({
    attemptId: orchestrationAttemptIdSchema,
    pollAttempt: z.number().int().min(1).max(100),
    scenario: localAiScenarioSchema,
  })
  .strict();

export type AudioOrchestrationPolicy = z.infer<typeof audioOrchestrationPolicySchema>;
export type AudioOrchestrationContext = z.infer<typeof audioOrchestrationContextSchema>;

export type AudioOrchestrationReceipt = Readonly<{
  attemptId: string;
  estimatedCostUnits: number;
  status: "queued";
}>;

export type AudioOrchestrationStatus =
  | Readonly<{
      actualCostUnits: number;
      attemptId: string;
      status: "completed";
    }>
  | Readonly<{
      attemptId: string;
      status: "queued";
    }>
  | Readonly<{
      actualCostUnits: number;
      attemptId: string;
      errorCode: "SYNTHETIC_TERMINAL_FAILURE";
      retryable: false;
      status: "failed";
    }>;

export type SyntheticAudioOutput = Readonly<{
  body: Uint8Array;
  contentType: "audio/wav";
  durationSeconds: number;
}>;

export interface AudioOrchestrationAdapter {
  submit(context: AudioOrchestrationContext): Promise<AudioOrchestrationReceipt>;
  getStatus(input: {
    attemptId: string;
    pollAttempt: number;
    scenario: LocalAiScenario;
  }): Promise<AudioOrchestrationStatus>;
  getOutput(input: {
    attemptId: string;
    candidateIndex: CandidateIndex;
    policy: AudioOrchestrationPolicy;
  }): Promise<SyntheticAudioOutput>;
  cancel(attemptId: string): Promise<Readonly<{ actualCostUnits: number; status: "cancelled" }>>;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPseudonymousCorrelationId(value: string): Promise<string> {
  const parsed = z.string().trim().min(16).max(256).parse(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed));
  return pseudonymousCorrelationIdSchema.parse(
    `ctx_${bytesToHex(new Uint8Array(digest)).slice(0, 32)}`,
  );
}

async function createAttemptId(context: AudioOrchestrationContext): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${context.correlationId}:${context.candidateIndex.toString()}`),
  );
  return orchestrationAttemptIdSchema.parse(
    `att_${bytesToHex(new Uint8Array(digest)).slice(0, 32)}`,
  );
}

export function createDeterministicSyntheticWave(
  candidateIndex: CandidateIndex,
  durationSeconds = 1,
): SyntheticAudioOutput {
  const parsedCandidateIndex = candidateIndexSchema.parse(candidateIndex);
  const parsedDuration = z.number().int().min(1).max(5).parse(durationSeconds);
  const sampleRate = 8_000;
  const sampleCount = sampleRate * parsedDuration;
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  const frequency = parsedCandidateIndex === 0 ? 261.63 : 329.63;
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 400, (sampleCount - index) / 400);
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.1 * fade;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }

  return { body: bytes, contentType: "audio/wav", durationSeconds: parsedDuration };
}

export function validateSyntheticAudioOutput(
  output: SyntheticAudioOutput,
  policy: AudioOrchestrationPolicy,
): SyntheticAudioOutput {
  const parsedPolicy = audioOrchestrationPolicySchema.parse(policy);
  if (
    output.contentType !== "audio/wav" ||
    output.body.byteLength <= 44 ||
    output.body.byteLength > parsedPolicy.maxOutputBytes ||
    output.durationSeconds <= 0 ||
    output.durationSeconds > parsedPolicy.maxOutputDurationSeconds ||
    new TextDecoder().decode(output.body.slice(0, 4)) !== "RIFF" ||
    new TextDecoder().decode(output.body.slice(8, 12)) !== "WAVE"
  ) {
    throw new TypeError("Synthetic audio output failed validation.");
  }
  return output;
}

export class DeterministicSyntheticAudioAdapter implements AudioOrchestrationAdapter {
  async submit(input: AudioOrchestrationContext): Promise<AudioOrchestrationReceipt> {
    const context = audioOrchestrationContextSchema.parse(input);
    return {
      attemptId: await createAttemptId(context),
      estimatedCostUnits: 1,
      status: "queued",
    };
  }

  async getStatus(input: {
    attemptId: string;
    pollAttempt: number;
    scenario: LocalAiScenario;
  }): Promise<AudioOrchestrationStatus> {
    const parsed = orchestrationPollSchema.parse(input);
    if (parsed.scenario === "terminal-failure") {
      return {
        actualCostUnits: 1,
        attemptId: parsed.attemptId,
        errorCode: "SYNTHETIC_TERMINAL_FAILURE",
        retryable: false,
        status: "failed",
      };
    }
    if (parsed.scenario === "timeout-recovery" && parsed.pollAttempt === 1) {
      return { attemptId: parsed.attemptId, status: "queued" };
    }
    return { actualCostUnits: 1, attemptId: parsed.attemptId, status: "completed" };
  }

  async getOutput(input: {
    attemptId: string;
    candidateIndex: CandidateIndex;
    policy: AudioOrchestrationPolicy;
  }): Promise<SyntheticAudioOutput> {
    orchestrationAttemptIdSchema.parse(input.attemptId);
    const candidateIndex = candidateIndexSchema.parse(input.candidateIndex);
    const policy = audioOrchestrationPolicySchema.parse(input.policy);
    return validateSyntheticAudioOutput(createDeterministicSyntheticWave(candidateIndex), policy);
  }

  async cancel(
    attemptId: string,
  ): Promise<Readonly<{ actualCostUnits: number; status: "cancelled" }>> {
    orchestrationAttemptIdSchema.parse(attemptId);
    return { actualCostUnits: 1, status: "cancelled" };
  }
}

export const orchestrationWakeSignalSchema = z
  .object({
    attemptId: orchestrationAttemptIdSchema,
    sequence: z.number().int().nonnegative().safe(),
  })
  .strict();

export function reconcileOrchestrationWakeSignal(
  state: Readonly<{ attemptId: string; lastSequence: number; terminal: boolean }>,
  signal: unknown,
): Readonly<{
  accepted: boolean;
  lastSequence: number;
  reason: "accepted" | "duplicate" | "late" | "out-of-order";
}> {
  const parsedState = z
    .object({
      attemptId: orchestrationAttemptIdSchema,
      lastSequence: z.number().int().min(-1).safe(),
      terminal: z.boolean(),
    })
    .strict()
    .parse(state);
  const parsedSignal = orchestrationWakeSignalSchema.parse(signal);
  if (parsedState.terminal) {
    return { accepted: false, lastSequence: parsedState.lastSequence, reason: "late" };
  }
  if (parsedSignal.attemptId !== parsedState.attemptId) {
    return { accepted: false, lastSequence: parsedState.lastSequence, reason: "out-of-order" };
  }
  if (parsedSignal.sequence <= parsedState.lastSequence) {
    return { accepted: false, lastSequence: parsedState.lastSequence, reason: "duplicate" };
  }
  return { accepted: true, lastSequence: parsedSignal.sequence, reason: "accepted" };
}
