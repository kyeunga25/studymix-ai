import { describe, expect, it } from "vitest";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  UnsupportedJsonMediaTypeError,
  readBoundedJsonResponse,
  readBoundedJsonWithBytes,
} from "./request-json";

const jsonHeaders = { "Content-Type": "application/json" };

function responseWithChunks(
  chunks: readonly Uint8Array[],
  headers: HeadersInit = jsonHeaders,
): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];
        index += 1;
        if (chunk === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    }),
    { headers },
  );
}

describe("bounded JSON reader", () => {
  it("accepts a JSON media type with parameters and preserves the exact request bytes", async () => {
    const source = '{"message":"專注"}';
    const request = new Request("https://studymix.example/api/test", {
      body: source,
      headers: { "Content-Type": "APPLICATION/JSON; charset=utf-8" },
      method: "POST",
    });

    const result = await readBoundedJsonWithBytes(request, 128);

    expect(result.value).toEqual({ message: "專注" });
    expect(result.bytes).toEqual(new TextEncoder().encode(source));
  });

  it("assembles chunked UTF-8 before decoding and accepts the exact byte limit", async () => {
    const bytes = new TextEncoder().encode('{"message":"專注"}');
    const response = responseWithChunks([bytes.slice(0, 13), bytes.slice(13)]);

    await expect(readBoundedJsonResponse(response, bytes.byteLength)).resolves.toEqual({
      message: "專注",
    });
  });

  it.each([undefined, "text/plain", "application/problem+json"])(
    "rejects unsupported media type %s",
    async (contentType) => {
      const headers = contentType === undefined ? undefined : { "Content-Type": contentType };
      const response = new Response("{}", headers === undefined ? undefined : { headers });

      await expect(readBoundedJsonResponse(response, 16)).rejects.toBeInstanceOf(
        UnsupportedJsonMediaTypeError,
      );
    },
  );

  it.each(["invalid", "-1", "17"])(
    "rejects invalid or oversized declared content length %s before reading",
    async (contentLength) => {
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{}"));
          },
        }),
        { headers: { ...jsonHeaders, "Content-Length": contentLength } },
      );

      await expect(readBoundedJsonResponse(response, 16)).rejects.toBeInstanceOf(
        JsonBodyTooLargeError,
      );
      expect(response.body?.locked).toBe(false);
    },
  );

  it("cancels a chunked body after the streamed bytes exceed the limit", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12"));
          controller.enqueue(new TextEncoder().encode("345"));
        },
      }),
      { headers: jsonHeaders },
    );

    await expect(readBoundedJsonResponse(response, 4)).rejects.toBeInstanceOf(
      JsonBodyTooLargeError,
    );
    expect(cancelled).toBe(true);
  });

  it("keeps the size classification when stream cancellation fails", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error("Synthetic cancellation failure.");
        },
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12"));
          controller.enqueue(new TextEncoder().encode("345"));
        },
      }),
      { headers: jsonHeaders },
    );

    await expect(readBoundedJsonResponse(response, 4)).rejects.toBeInstanceOf(
      JsonBodyTooLargeError,
    );
  });

  it.each([
    ["an empty body", new Response(null, { headers: jsonHeaders })],
    ["malformed JSON", new Response("{", { headers: jsonHeaders })],
    [
      "invalid UTF-8",
      new Response(new Uint8Array([0xff]), {
        headers: jsonHeaders,
      }),
    ],
  ] as const)("rejects %s", async (_label, response) => {
    await expect(readBoundedJsonResponse(response, 16)).rejects.toBeInstanceOf(
      InvalidJsonBodyError,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects an invalid maximum byte limit %s",
    async (maximumBytes) => {
      await expect(
        readBoundedJsonResponse(new Response("{}", { headers: jsonHeaders }), maximumBytes),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );
});
