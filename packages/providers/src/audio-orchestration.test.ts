import { describe, expect, it } from "vitest";
import {
  DeterministicSyntheticAudioAdapter,
  audioOrchestrationContextSchema,
  createPseudonymousCorrelationId,
  reconcileOrchestrationWakeSignal,
} from "./audio-orchestration";

const policy = {
  candidateCount: 2,
  maxAttemptsPerCandidate: 3,
  maxConcurrentCandidates: 1,
  maxCostUnits: 4,
  maxInputDurationSeconds: 30,
  maxOutputBytes: 65_536,
  maxOutputDurationSeconds: 5,
  qualityTier: "synthetic-preview",
  retentionSeconds: 86_400,
} as const;

async function context(scenario: "success" | "terminal-failure" | "timeout-recovery") {
  return audioOrchestrationContextSchema.parse({
    candidateIndex: 0,
    correlationId: await createPseudonymousCorrelationId(
      "job_0123456789abcdef0123456789abcdef:candidate:0",
    ),
    policy,
    preset: { id: "soft-piano", version: 1 },
    scenario,
    source: { contentType: "audio/wav", durationSeconds: 2, sizeBytes: 32_044 },
  });
}

describe("provider-neutral audio orchestration", () => {
  it("uses stable pseudonymous attempt IDs and bounded synthetic audio", async () => {
    const adapter = new DeterministicSyntheticAudioAdapter();
    const input = await context("success");
    const first = await adapter.submit(input);
    const repeated = await adapter.submit(input);

    expect(first).toEqual(repeated);
    expect(first.attemptId).toMatch(/^att_[0-9a-f]{32}$/);
    expect(first.attemptId).not.toContain("job_");
    const output = await adapter.getOutput({
      attemptId: first.attemptId,
      candidateIndex: 0,
      policy,
    });
    expect(output).toMatchObject({ contentType: "audio/wav", durationSeconds: 1 });
    expect(output.body.byteLength).toBe(16_044);
  });

  it("fails closed for invalid input duration, size, and policy", async () => {
    const valid = await context("success");
    expect(() =>
      audioOrchestrationContextSchema.parse({
        ...valid,
        source: { ...valid.source, durationSeconds: 31 },
      }),
    ).toThrow();
    expect(() =>
      audioOrchestrationContextSchema.parse({
        ...valid,
        source: { ...valid.source, sizeBytes: 0 },
      }),
    ).toThrow();
    expect(() =>
      audioOrchestrationContextSchema.parse({
        ...valid,
        policy: { ...valid.policy, maxConcurrentCandidates: 3 },
      }),
    ).toThrow();
  });

  it("models timeout recovery and terminal provider cost independently", async () => {
    const adapter = new DeterministicSyntheticAudioAdapter();
    const recoveryReceipt = await adapter.submit(await context("timeout-recovery"));
    await expect(
      adapter.getStatus({
        attemptId: recoveryReceipt.attemptId,
        pollAttempt: 1,
        scenario: "timeout-recovery",
      }),
    ).resolves.toMatchObject({ status: "queued" });
    await expect(
      adapter.getStatus({
        attemptId: recoveryReceipt.attemptId,
        pollAttempt: 2,
        scenario: "timeout-recovery",
      }),
    ).resolves.toMatchObject({ actualCostUnits: 1, status: "completed" });

    const failedReceipt = await adapter.submit(await context("terminal-failure"));
    await expect(
      adapter.getStatus({
        attemptId: failedReceipt.attemptId,
        pollAttempt: 1,
        scenario: "terminal-failure",
      }),
    ).resolves.toMatchObject({ actualCostUnits: 1, retryable: false, status: "failed" });
  });

  it("ignores duplicate, out-of-order, and late wake-up signals", () => {
    const attemptId = "att_0123456789abcdef0123456789abcdef";
    expect(
      reconcileOrchestrationWakeSignal(
        { attemptId, lastSequence: -1, terminal: false },
        { attemptId, sequence: 0 },
      ),
    ).toEqual({ accepted: true, lastSequence: 0, reason: "accepted" });
    expect(
      reconcileOrchestrationWakeSignal(
        { attemptId, lastSequence: 0, terminal: false },
        { attemptId, sequence: 0 },
      ).reason,
    ).toBe("duplicate");
    expect(
      reconcileOrchestrationWakeSignal(
        { attemptId, lastSequence: 0, terminal: false },
        { attemptId: "att_11111111111111111111111111111111", sequence: 1 },
      ).reason,
    ).toBe("out-of-order");
    expect(
      reconcileOrchestrationWakeSignal(
        { attemptId, lastSequence: 1, terminal: true },
        { attemptId, sequence: 2 },
      ).reason,
    ).toBe("late");
  });
});
