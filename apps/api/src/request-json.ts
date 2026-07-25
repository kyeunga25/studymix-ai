export class UnsupportedJsonMediaTypeError extends Error {
  override readonly name = "UnsupportedJsonMediaTypeError";
}

export class JsonBodyTooLargeError extends Error {
  override readonly name = "JsonBodyTooLargeError";
}

export class InvalidJsonBodyError extends Error {
  override readonly name = "InvalidJsonBodyError";
}

export type BoundedJsonBody = Readonly<{
  bytes: Uint8Array;
  value: unknown;
}>;

async function readBoundedJsonStream(
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<BoundedJsonBody> {
  const mediaType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new UnsupportedJsonMediaTypeError("The request must use application/json.");
  }

  const contentLength = headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes) {
      throw new JsonBodyTooLargeError("The JSON request body is too large.");
    }
  }

  if (body === null) {
    throw new InvalidJsonBodyError("A JSON request body is required.");
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new JsonBodyTooLargeError("The JSON request body is too large.");
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    return { bytes, value: parsed };
  } catch {
    throw new InvalidJsonBodyError("The request body is not valid UTF-8 JSON.");
  }
}

export async function readBoundedJsonWithBytes(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonBody> {
  return await readBoundedJsonStream(request.headers, request.body, maximumBytes);
}

export async function readBoundedJsonResponse(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  return (await readBoundedJsonStream(response.headers, response.body, maximumBytes)).value;
}

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  return (await readBoundedJsonWithBytes(request, maximumBytes)).value;
}
