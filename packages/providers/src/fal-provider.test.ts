import type { PresetId } from "@studymix/contracts";
import { resolvePreset, type ResolvedStylePreset } from "@studymix/presets";
import { describe, expect, it, vi } from "vitest";
import {
  FalMusicGenerationProvider,
  type FalQueuePort,
  type FalQueueSubmitOptions,
} from "./fal-provider";

const jobId = "job_0123456789abcdef0123456789abcdef";

function requireTestPreset(id: PresetId = "soft-piano"): ResolvedStylePreset {
  const resolved = resolvePreset(id, 1);
  if (resolved === undefined) {
    throw new Error("Test preset is unavailable.");
  }
  return resolved;
}

const preset = requireTestPreset();

function createQueue(overrides: Partial<FalQueuePort> = {}): FalQueuePort {
  return {
    cancel: vi.fn(async () => undefined),
    result: vi.fn(async (providerRequestId) => ({
      data: {
        audio: {
          content_type: "audio/mpeg",
          file_size: 12_345,
          url: "https://v3.fal.media/files/example/output.mp3",
        },
        lyrics: "[inst]",
        seed: 42,
        tags: preset.providerParameters.targetTags,
      },
      requestId: providerRequestId,
    })),
    status: vi.fn(async (providerRequestId) => ({
      request_id: providerRequestId,
      status: "COMPLETED",
    })),
    submit: vi.fn(async () => ({
      request_id: "fal-request-1",
      status: "IN_QUEUE",
    })),
    ...overrides,
  };
}

function createProvider(queue: FalQueuePort): FalMusicGenerationProvider {
  return new FalMusicGenerationProvider({
    outputExpirationSeconds: 3_600,
    queue,
    startTimeoutSeconds: 300,
    webhookUrl: "https://api.example.test/api/webhooks/fal",
  });
}

describe("fal music generation provider", () => {
  it("maps a pinned preset to the ACE-Step audio-to-audio contract", async () => {
    let captured: FalQueueSubmitOptions | undefined;
    const queue = createQueue({
      submit: vi.fn(async (options) => {
        captured = options;
        return { request_id: "fal-request-1", status: "IN_QUEUE" };
      }),
    });
    const provider = createProvider(queue);

    await expect(
      provider.submit({
        candidateIndex: 0,
        idempotencyKey: `${jobId}:0`,
        jobId,
        preset,
        sourceAudioUrl: "https://private.example.test/source?signature=redacted",
      }),
    ).resolves.toEqual({ providerRequestId: "fal-request-1", status: "queued" });

    expect(captured).toEqual({
      headers: { "X-Fal-Store-IO": "0" },
      input: {
        audio_url: "https://private.example.test/source?signature=redacted",
        edit_mode: "remix",
        lyrics: "[inst]",
        original_lyrics: "",
        original_tags: preset.providerParameters.targetTags,
        tags: preset.providerParameters.targetTags,
      },
      outputExpirationSeconds: 3_600,
      startTimeoutSeconds: 300,
      webhookUrl: "https://api.example.test/api/webhooks/fal",
    });
  });

  it.each([
    ["acoustic-ease", "acoustic guitar", "soft piano"],
    ["slowwave", "slow-paced ambient electronic", "gentle pulse"],
  ] as const)(
    "maps the %s style through the bounded provider adapter",
    async (id, first, second) => {
      let captured: FalQueueSubmitOptions | undefined;
      const selectedPreset = requireTestPreset(id);
      const provider = createProvider(
        createQueue({
          submit: vi.fn(async (options) => {
            captured = options;
            return { request_id: `fal-${id}`, status: "IN_QUEUE" };
          }),
        }),
      );

      await provider.submit({
        candidateIndex: 0,
        idempotencyKey: `${jobId}:${id}`,
        jobId,
        preset: selectedPreset,
        sourceAudioUrl: "https://private.example.test/source?signature=redacted",
      });

      expect(captured?.input).toMatchObject({
        edit_mode: "remix",
        lyrics: "[inst]",
        original_lyrics: "",
        original_tags: selectedPreset.providerParameters.targetTags,
        tags: selectedPreset.providerParameters.targetTags,
      });
      expect(captured?.input.tags).toContain(first);
      expect(captured?.input.tags).toContain(second);
    },
  );

  it.each([
    ["IN_QUEUE", "queued"],
    ["IN_PROGRESS", "generating"],
    ["COMPLETED", "completed"],
  ] as const)("maps %s queue status to %s", async (falStatus, expectedStatus) => {
    const provider = createProvider(
      createQueue({
        status: vi.fn(async (providerRequestId) => ({
          request_id: providerRequestId,
          status: falStatus,
        })),
      }),
    );

    await expect(provider.getStatus("fal-request-1")).resolves.toEqual({
      providerRequestId: "fal-request-1",
      status: expectedStatus,
    });
  });

  it("maps completed queue errors without exposing provider messages", async () => {
    const retryable = createProvider(
      createQueue({
        status: vi.fn(async (providerRequestId) => ({
          error: "Sensitive upstream detail.",
          error_type: "runner_connection_timeout",
          request_id: providerRequestId,
          status: "COMPLETED",
        })),
      }),
    );
    const terminal = createProvider(
      createQueue({
        status: vi.fn(async (providerRequestId) => ({
          error: "Sensitive validation detail.",
          error_type: "bad_request",
          request_id: providerRequestId,
          status: "COMPLETED",
        })),
      }),
    );

    await expect(retryable.getStatus("fal-request-1")).resolves.toEqual({
      errorCode: "FAL_RUNNER_CONNECTION_TIMEOUT",
      providerRequestId: "fal-request-1",
      retryable: true,
      status: "failed",
    });
    await expect(terminal.getStatus("fal-request-1")).resolves.toEqual({
      errorCode: "FAL_BAD_REQUEST",
      providerRequestId: "fal-request-1",
      retryable: false,
      status: "failed",
    });
  });

  it("returns only allowlisted output data and minimal provider metadata", async () => {
    const provider = createProvider(createQueue());

    await expect(provider.getResult("fal-request-1")).resolves.toEqual({
      outputUrl: "https://v3.fal.media/files/example/output.mp3",
      providerMetadata: { contentType: "audio/mpeg", fileSize: 12_345 },
      providerRequestId: "fal-request-1",
      seed: 42,
      status: "completed",
    });
  });

  it("fails closed for mismatched request IDs and unexpected output hosts", async () => {
    const mismatched = createProvider(
      createQueue({
        status: vi.fn(async () => ({ request_id: "different-request", status: "COMPLETED" })),
      }),
    );
    const unexpectedHost = createProvider(
      createQueue({
        result: vi.fn(async (providerRequestId) => ({
          data: {
            audio: { url: "https://untrusted.example.test/output.mp3" },
            lyrics: "[inst]",
            seed: 42,
            tags: "instrumental",
          },
          requestId: providerRequestId,
        })),
      }),
    );

    await expect(mismatched.getStatus("fal-request-1")).rejects.toThrow(
      "request ID does not match",
    );
    await expect(unexpectedHost.getResult("fal-request-1")).rejects.toThrow(
      "output URL host is not allowed",
    );
  });

  it("validates source URLs before making a provider request", async () => {
    const queue = createQueue();
    const provider = createProvider(queue);

    await expect(
      provider.submit({
        candidateIndex: 1,
        idempotencyKey: `${jobId}:1`,
        jobId,
        preset,
        sourceAudioUrl: "http://private.example.test/source",
      }),
    ).rejects.toThrow();
    expect(queue.submit).not.toHaveBeenCalled();
  });

  it("validates and forwards cancellation request IDs", async () => {
    const queue = createQueue();
    const provider = createProvider(queue);

    await provider.cancel("fal-request-1");

    expect(queue.cancel).toHaveBeenCalledWith("fal-request-1");
    await expect(provider.cancel("request/id")).rejects.toThrow();
  });
});
