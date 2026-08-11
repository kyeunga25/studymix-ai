import { describe, expect, it } from "vitest";
import {
  InvalidJsonResponseError,
  JsonResponseTooLargeError,
  MAXIMUM_WEB_JSON_RESPONSE_BYTES,
  readBoundedWebJsonResponse,
  UnsupportedJsonResponseMediaTypeError,
} from "./bounded-json-response";

describe("bounded web JSON responses", () => {
  it("accepts bounded JSON with a normal media-type parameter", async () => {
    const response = new Response('{"status":"ok"}', {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    await expect(readBoundedWebJsonResponse(response)).resolves.toEqual({ status: "ok" });
  });

  it("rejects missing and unexpected JSON media types", async () => {
    await expect(readBoundedWebJsonResponse(new Response("{}"))).rejects.toBeInstanceOf(
      UnsupportedJsonResponseMediaTypeError,
    );
    await expect(
      readBoundedWebJsonResponse(new Response("{}", { headers: { "Content-Type": "text/html" } })),
    ).rejects.toBeInstanceOf(UnsupportedJsonResponseMediaTypeError);
  });

  it("rejects invalid or oversized declared lengths before reading", async () => {
    for (const contentLength of ["invalid", String(MAXIMUM_WEB_JSON_RESPONSE_BYTES + 1)]) {
      const response = new Response("{}", {
        headers: {
          "Content-Length": contentLength,
          "Content-Type": "application/json",
        },
      });

      await expect(readBoundedWebJsonResponse(response)).rejects.toBeInstanceOf(
        JsonResponseTooLargeError,
      );
      expect(response.bodyUsed).toBe(false);
    }
  });

  it("counts the actual stream and attempts cancellation when no length is declared", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(MAXIMUM_WEB_JSON_RESPONSE_BYTES + 1));
      },
    });

    await expect(
      readBoundedWebJsonResponse(
        new Response(stream, { headers: { "Content-Type": "application/json" } }),
      ),
    ).rejects.toBeInstanceOf(JsonResponseTooLargeError);
    expect(cancelled).toBe(true);
  });

  it("does not let a cancellation failure hide the size classification", async () => {
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("Synthetic cancellation failure.");
      },
      start(controller) {
        controller.enqueue(new Uint8Array(MAXIMUM_WEB_JSON_RESPONSE_BYTES + 1));
      },
    });

    await expect(
      readBoundedWebJsonResponse(
        new Response(stream, { headers: { "Content-Type": "application/json" } }),
      ),
    ).rejects.toBeInstanceOf(JsonResponseTooLargeError);
  });

  it("preserves an AbortError raised while the response stream is being read", async () => {
    const abortError = new DOMException("Synthetic aborted response.", "AbortError");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(abortError);
      },
    });

    await expect(
      readBoundedWebJsonResponse(
        new Response(stream, { headers: { "Content-Type": "application/json" } }),
      ),
    ).rejects.toBe(abortError);
  });

  it("rejects an empty body, malformed JSON, and invalid UTF-8", async () => {
    const headers = { "Content-Type": "application/json" };

    await expect(
      readBoundedWebJsonResponse(new Response(null, { headers })),
    ).rejects.toBeInstanceOf(InvalidJsonResponseError);
    await expect(readBoundedWebJsonResponse(new Response("{", { headers }))).rejects.toBeInstanceOf(
      InvalidJsonResponseError,
    );
    await expect(
      readBoundedWebJsonResponse(new Response(new Uint8Array([0xc3, 0x28]), { headers })),
    ).rejects.toBeInstanceOf(InvalidJsonResponseError);
  });
});
