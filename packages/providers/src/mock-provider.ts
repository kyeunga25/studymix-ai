import { jobIdSchema } from "@studymix/contracts";
import { z } from "zod";
import type {
  GenerationProviderResult,
  GenerationProviderStatus,
  GenerationSubmission,
  GenerationSubmissionResult,
  MusicGenerationProvider,
} from "./types";

const mockProviderRequestIdSchema = z.string().regex(/^mock:job_[0-9a-f]{32}:[01]$/);

function parseProviderRequestId(providerRequestId: string): {
  candidateIndex: 0 | 1;
  jobId: string;
} {
  const parsed = mockProviderRequestIdSchema.parse(providerRequestId);
  const segments = parsed.split(":");
  const jobId = jobIdSchema.parse(segments[1]);
  return {
    candidateIndex: segments[2] === "0" ? 0 : 1,
    jobId,
  };
}

function waveFile(candidateIndex: 0 | 1): Uint8Array {
  const sampleRate = 8_000;
  const sampleCount = sampleRate;
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

  const frequency = candidateIndex === 0 ? 261.63 : 329.63;
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 400, (sampleCount - index) / 400);
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.1 * fade;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 4_096;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export type MockAudioOutput = Readonly<{
  body: Uint8Array;
  contentType: "audio/wav";
  durationSeconds: 1;
}>;

export function decodeMockAudioOutput(outputUrl: string): MockAudioOutput {
  const prefix = "data:audio/wav;base64,";
  if (!outputUrl.startsWith(prefix)) {
    throw new TypeError("Mock provider output is invalid.");
  }
  const binary = atob(outputUrl.slice(prefix.length));
  const body = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (body.byteLength !== 16_044) {
    throw new TypeError("Mock provider output has an invalid size.");
  }
  return { body, contentType: "audio/wav", durationSeconds: 1 };
}

export class MockMusicGenerationProvider implements MusicGenerationProvider {
  readonly name = "mock" as const;

  async submit(input: GenerationSubmission): Promise<GenerationSubmissionResult> {
    return await Promise.resolve({
      providerRequestId: `mock:${jobIdSchema.parse(input.jobId)}:${input.candidateIndex}`,
      status: "queued" as const,
    });
  }

  async getStatus(providerRequestId: string): Promise<GenerationProviderStatus> {
    parseProviderRequestId(providerRequestId);
    return await Promise.resolve({ providerRequestId, status: "completed" as const });
  }

  async getResult(providerRequestId: string): Promise<GenerationProviderResult> {
    const { candidateIndex } = parseProviderRequestId(providerRequestId);
    return await Promise.resolve({
      durationSeconds: 1,
      outputUrl: `data:audio/wav;base64,${bytesToBase64(waveFile(candidateIndex))}`,
      providerRequestId,
      status: "completed" as const,
    });
  }
}
