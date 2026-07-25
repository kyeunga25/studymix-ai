import { describe, expect, it } from "vitest";
import { resolvePreset } from "@studymix/presets";
import { MockMusicGenerationProvider, decodeMockAudioOutput } from "./mock-provider";

const jobId = "job_0123456789abcdef0123456789abcdef";
const preset = resolvePreset("soft-piano", 1);

if (preset === undefined) {
  throw new Error("Test preset is unavailable.");
}

describe("mock music generation provider", () => {
  it("returns a stable provider request ID without paid credentials", async () => {
    const provider = new MockMusicGenerationProvider();
    const input = {
      candidateIndex: 0 as const,
      idempotencyKey: `${jobId}:0`,
      jobId,
      preset,
      sourceAudioUrl: "https://example.test/private-source",
    };

    await expect(provider.submit(input)).resolves.toEqual({
      providerRequestId: `${"mock:"}${jobId}:0`,
      status: "queued",
    });
    await expect(provider.submit(input)).resolves.toEqual({
      providerRequestId: `${"mock:"}${jobId}:0`,
      status: "queued",
    });
  });

  it("produces two bounded synthetic WAV outputs", async () => {
    const provider = new MockMusicGenerationProvider();
    const first = await provider.getResult(`mock:${jobId}:0`);
    const second = await provider.getResult(`mock:${jobId}:1`);
    const firstAudio = decodeMockAudioOutput(first.outputUrl);
    const secondAudio = decodeMockAudioOutput(second.outputUrl);

    expect(firstAudio.contentType).toBe("audio/wav");
    expect(firstAudio.body.byteLength).toBe(16_044);
    expect(new TextDecoder().decode(firstAudio.body.slice(0, 4))).toBe("RIFF");
    expect(firstAudio.body).not.toEqual(secondAudio.body);
  });

  it("rejects unknown provider request identifiers", async () => {
    const provider = new MockMusicGenerationProvider();

    await expect(provider.getStatus("external-request")).rejects.toBeInstanceOf(Error);
    expect(() => decodeMockAudioOutput("https://example.test/output.wav")).toThrow();
  });
});
