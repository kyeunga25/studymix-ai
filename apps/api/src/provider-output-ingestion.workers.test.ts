import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderOutputIngestionError,
  createBoundedProviderOutputStream,
  ingestProviderOutput,
  type ProviderOutputFetcher,
} from "./provider-output-ingestion";

const firstObjectKey =
  "owners/own_11111111111111111111111111111111/outputs/out_11111111111111111111111111111111/candidate";
const secondObjectKey =
  "owners/own_22222222222222222222222222222222/outputs/out_22222222222222222222222222222222/candidate";
const thirdObjectKey =
  "owners/own_33333333333333333333333333333333/outputs/out_33333333333333333333333333333333/candidate";
const fourthObjectKey =
  "owners/own_44444444444444444444444444444444/outputs/out_44444444444444444444444444444444/candidate";
const falOutputUrl = "https://v3.fal.media/files/example/output.mp3";

function audioResponse(
  chunks: readonly Uint8Array[],
  headers: Readonly<Record<string, string>> = {},
): Response {
  const sizeBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Length": sizeBytes.toString(),
      "Content-Type": "audio/mpeg",
      ...headers,
    },
    status: 200,
  });
}

function ingestionInput(
  objectKey: string,
  fetcher: ProviderOutputFetcher,
): Parameters<typeof ingestProviderOutput>[0] {
  return {
    allowedHosts: ["fal.media"],
    bucket: env.AUDIO_BUCKET,
    fetcher,
    maxBytes: 8,
    objectKey,
    outputUrl: falOutputUrl,
    timeoutMilliseconds: 5_000,
  };
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return;
    }
  }
}

describe("provider output ingestion", () => {
  beforeEach(async () => {
    await env.AUDIO_BUCKET.delete(firstObjectKey);
    await env.AUDIO_BUCKET.delete(secondObjectKey);
    await env.AUDIO_BUCKET.delete(thirdObjectKey);
    await env.AUDIO_BUCKET.delete(fourthObjectKey);
  });

  it("streams an allowlisted audio response into private R2 with minimal metadata", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("GET");
      expect(request.redirect).toBe("manual");
      expect(request.headers.get("accept-encoding")).toBe("identity");
      return audioResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4])], {
        "Content-Length": "4",
      });
    });

    await expect(
      ingestProviderOutput({
        ...ingestionInput(firstObjectKey, fetcher),
        expectedContentType: "audio/mpeg",
        expectedSizeBytes: 4,
      }),
    ).resolves.toEqual({ contentType: "audio/mpeg", sizeBytes: 4 });

    const stored = await env.AUDIO_BUCKET.head(firstObjectKey);
    expect(stored).not.toBeNull();
    expect(stored?.size).toBe(4);
    expect(stored?.httpMetadata?.contentType).toBe("audio/mpeg");
    expect(stored?.customMetadata).toEqual({ ingestionVersion: "provider-v1" });
  });

  it("returns a previously verified object without fetching the expiring provider URL again", async () => {
    await env.AUDIO_BUCKET.put(firstObjectKey, new Uint8Array([1, 2, 3, 4]), {
      customMetadata: { ingestionVersion: "provider-v1" },
      httpMetadata: { contentType: "audio/mpeg" },
    });
    const fetcher = vi.fn(async () => audioResponse([new Uint8Array([9])]));

    await expect(
      ingestProviderOutput({
        ...ingestionInput(firstObjectKey, fetcher),
        expectedContentType: "audio/mpeg",
        expectedSizeBytes: 4,
      }),
    ).resolves.toEqual({ contentType: "audio/mpeg", sizeBytes: 4 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects untrusted destinations and redirects before writing an object", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, { headers: { Location: "https://example.test/output" }, status: 302 }),
    );

    await expect(
      ingestProviderOutput({
        ...ingestionInput(secondObjectKey, fetcher),
        outputUrl: "https://fal.media.example.test/output.mp3",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT_URL", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      ingestProviderOutput({
        ...ingestionInput(secondObjectKey, fetcher),
        outputUrl: "https://v3.fal.media:8443/files/example/output.mp3",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT_URL", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      ingestProviderOutput(ingestionInput(secondObjectKey, fetcher)),
    ).rejects.toMatchObject({ code: "OUTPUT_RESPONSE_INVALID", retryable: false });
    expect(await env.AUDIO_BUCKET.head(secondObjectKey)).toBeNull();
  });

  it("marks network and provider availability failures as retryable", async () => {
    const networkFailure = vi.fn(async (): Promise<Response> => {
      throw new Error("Synthetic network failure.");
    });
    const providerUnavailable = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(
      ingestProviderOutput(ingestionInput(secondObjectKey, networkFailure)),
    ).rejects.toMatchObject({ code: "OUTPUT_FETCH_FAILED", retryable: true });
    await expect(
      ingestProviderOutput(ingestionInput(secondObjectKey, providerUnavailable)),
    ).rejects.toMatchObject({ code: "OUTPUT_RESPONSE_INVALID", retryable: true });
    expect(await env.AUDIO_BUCKET.head(secondObjectKey)).toBeNull();
  });

  it("rejects declared and streamed responses over the maximum size", async () => {
    const declaredTooLarge = vi.fn(async () =>
      audioResponse([new Uint8Array([1])], { "Content-Length": "9" }),
    );
    await expect(
      ingestProviderOutput(ingestionInput(thirdObjectKey, declaredTooLarge)),
    ).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE", retryable: false });

    const oversizedResponse = audioResponse([
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8, 9]),
    ]);
    if (oversizedResponse.body === null) {
      throw new Error("Expected the bounded-stream test body.");
    }
    const oversizedStream = createBoundedProviderOutputStream(
      oversizedResponse.body,
      8,
      () => undefined,
    );
    await expect(drainStream(oversizedStream)).rejects.toBeInstanceOf(ProviderOutputIngestionError);
    expect(await env.AUDIO_BUCKET.head(thirdObjectKey)).toBeNull();
  });

  it("rejects empty, encoded, or mismatched audio metadata and removes invalid writes", async () => {
    const empty = vi.fn(async () => audioResponse([]));
    const encoded = vi.fn(async () =>
      audioResponse([new Uint8Array([1])], { "Content-Encoding": "gzip" }),
    );
    const nonAudio = vi.fn(async () =>
      audioResponse([new Uint8Array([1])], { "Content-Type": "text/html" }),
    );
    const mismatched = vi.fn(async () => audioResponse([new Uint8Array([1, 2])]));

    await expect(
      ingestProviderOutput(ingestionInput(fourthObjectKey, empty)),
    ).rejects.toMatchObject({ code: "OUTPUT_RESPONSE_INVALID", retryable: false });
    expect(await env.AUDIO_BUCKET.head(fourthObjectKey)).toBeNull();

    await expect(
      ingestProviderOutput(ingestionInput(fourthObjectKey, encoded)),
    ).rejects.toMatchObject({ code: "OUTPUT_RESPONSE_INVALID", retryable: false });

    await expect(
      ingestProviderOutput(ingestionInput(fourthObjectKey, nonAudio)),
    ).rejects.toMatchObject({ code: "OUTPUT_RESPONSE_INVALID", retryable: false });

    await expect(
      ingestProviderOutput({
        ...ingestionInput(fourthObjectKey, mismatched),
        expectedSizeBytes: 3,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_METADATA_MISMATCH", retryable: false });
    expect(await env.AUDIO_BUCKET.head(fourthObjectKey)).toBeNull();
  });
});
