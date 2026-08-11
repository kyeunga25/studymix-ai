export const MAXIMUM_WEB_JSON_RESPONSE_BYTES = 65_536;

export class UnsupportedJsonResponseMediaTypeError extends Error {
  override readonly name = "UnsupportedJsonResponseMediaTypeError";
}

export class JsonResponseTooLargeError extends Error {
  override readonly name = "JsonResponseTooLargeError";
}

export class InvalidJsonResponseError extends Error {
  override readonly name = "InvalidJsonResponseError";
}

export async function readBoundedWebJsonResponse(response: Response): Promise<unknown> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new UnsupportedJsonResponseMediaTypeError(
      "The web API response must use application/json.",
    );
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAXIMUM_WEB_JSON_RESPONSE_BYTES)
  ) {
    throw new JsonResponseTooLargeError("The web API JSON response is too large.");
  }

  if (response.body === null) {
    throw new InvalidJsonResponseError("The web API JSON response body is missing.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > MAXIMUM_WEB_JSON_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Keep the bounded failure even when the transport cannot be cancelled cleanly.
        }
        throw new JsonResponseTooLargeError("The web API JSON response is too large.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new InvalidJsonResponseError("The web API response is not valid UTF-8 JSON.");
  }
}
