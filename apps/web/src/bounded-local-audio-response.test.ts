import { maximumLocalAiOutputBytes } from "@studymix/contracts";
import { describe, expect, it } from "vitest";
import {
  InvalidLocalAudioResponseError,
  LocalAudioResponseTooLargeError,
  readBoundedLocalAudioResponse,
  UnsupportedLocalAudioResponseMediaTypeError,
} from "./bounded-local-audio-response";

function syntheticWave(byteLength = 48): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

function localAudioResponse(
  body: BodyInit | null,
  contentLength: string,
  contentType = "audio/wav",
): Response {
  return new Response(body, {
    headers: { "Content-Length": contentLength, "Content-Type": contentType },
  });
}

describe("bounded local audio responses", () => {
  it("accepts an exact bounded WAV response with a normal media-type parameter", async () => {
    const bytes = syntheticWave();
    const blob = await readBoundedLocalAudioResponse(
      localAudioResponse(bytes, bytes.byteLength.toString(), "audio/wav; codecs=1"),
    );

    expect(blob.size).toBe(bytes.byteLength);
    expect(blob.type).toBe("audio/wav");
  });

  it("rejects failed responses and missing or unexpected media types", async () => {
    const bytes = syntheticWave();
    await expect(
      readBoundedLocalAudioResponse(
        new Response(bytes, {
          headers: { "Content-Length": bytes.byteLength.toString() },
          status: 503,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidLocalAudioResponseError);
    await expect(
      readBoundedLocalAudioResponse(
        new Response(bytes, { headers: { "Content-Length": bytes.byteLength.toString() } }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedLocalAudioResponseMediaTypeError);
    await expect(
      readBoundedLocalAudioResponse(
        localAudioResponse(bytes, bytes.byteLength.toString(), "text/plain"),
      ),
    ).rejects.toBeInstanceOf(UnsupportedLocalAudioResponseMediaTypeError);
  });

  it("rejects missing, malformed, empty, unsafe, and oversized declared lengths before reading", async () => {
    const bytes = syntheticWave();
    const responses = [
      new Response(bytes, { headers: { "Content-Type": "audio/wav" } }),
      localAudioResponse(bytes, "invalid"),
      localAudioResponse(bytes, "0"),
      localAudioResponse(bytes, "999999999999999999999"),
      localAudioResponse(bytes, (maximumLocalAiOutputBytes + 1).toString()),
    ];

    for (const response of responses) {
      await expect(readBoundedLocalAudioResponse(response)).rejects.toBeInstanceOf(Error);
      expect(response.bodyUsed).toBe(false);
    }
  });

  it("rejects declared lengths that do not match the actual body", async () => {
    const bytes = syntheticWave();
    await expect(
      readBoundedLocalAudioResponse(localAudioResponse(bytes, (bytes.byteLength + 1).toString())),
    ).rejects.toBeInstanceOf(InvalidLocalAudioResponseError);
    await expect(
      readBoundedLocalAudioResponse(localAudioResponse(bytes, (bytes.byteLength - 1).toString())),
    ).rejects.toBeInstanceOf(InvalidLocalAudioResponseError);
  });

  it("bounds the actual stream and attempts cancellation", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(maximumLocalAiOutputBytes + 1));
      },
    });

    await expect(
      readBoundedLocalAudioResponse(
        localAudioResponse(stream, maximumLocalAiOutputBytes.toString()),
      ),
    ).rejects.toBeInstanceOf(LocalAudioResponseTooLargeError);
    expect(cancelled).toBe(true);
  });

  it("preserves an AbortError raised while the response stream is being read", async () => {
    const abortError = new DOMException("Synthetic aborted local audio.", "AbortError");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(abortError);
      },
    });

    await expect(readBoundedLocalAudioResponse(localAudioResponse(stream, "48"))).rejects.toBe(
      abortError,
    );
  });

  it("rejects a body without the RIFF and WAVE markers", async () => {
    const bytes = new Uint8Array(48);
    await expect(
      readBoundedLocalAudioResponse(localAudioResponse(bytes, bytes.byteLength.toString())),
    ).rejects.toBeInstanceOf(InvalidLocalAudioResponseError);
  });
});
