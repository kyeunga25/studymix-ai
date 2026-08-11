import { maximumLocalAiOutputBytes } from "@studymix/contracts";

const minimumWaveBytes = 45;

export class UnsupportedLocalAudioResponseMediaTypeError extends Error {
  override readonly name = "UnsupportedLocalAudioResponseMediaTypeError";
}

export class LocalAudioResponseTooLargeError extends Error {
  override readonly name = "LocalAudioResponseTooLargeError";
}

export class InvalidLocalAudioResponseError extends Error {
  override readonly name = "InvalidLocalAudioResponseError";
}

function containsAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  return Array.from(expected, (character) => character.charCodeAt(0)).every(
    (value, index) => bytes[offset + index] === value,
  );
}

function isSyntheticWave(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= minimumWaveBytes &&
    containsAscii(bytes, 0, "RIFF") &&
    containsAscii(bytes, 8, "WAVE")
  );
}

export async function readBoundedLocalAudioResponse(response: Response): Promise<Blob> {
  if (!response.ok) {
    throw new InvalidLocalAudioResponseError("The private local audio response failed.");
  }

  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "audio/wav") {
    throw new UnsupportedLocalAudioResponseMediaTypeError(
      "The private local audio response must use audio/wav.",
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === null || !/^[1-9]\d*$/.test(contentLength)) {
    throw new InvalidLocalAudioResponseError("The private local audio response length is invalid.");
  }
  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes)) {
    throw new InvalidLocalAudioResponseError("The private local audio response length is invalid.");
  }
  if (declaredBytes > maximumLocalAiOutputBytes) {
    throw new LocalAudioResponseTooLargeError("The private local audio response is too large.");
  }
  if (declaredBytes < minimumWaveBytes) {
    throw new InvalidLocalAudioResponseError("The private local audio response is incomplete.");
  }

  if (response.body === null) {
    throw new InvalidLocalAudioResponseError("The private local audio response body is missing.");
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
      if (totalBytes > maximumLocalAiOutputBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded failure when transport cancellation also fails.
        }
        throw new LocalAudioResponseTooLargeError("The private local audio response is too large.");
      }
      if (totalBytes > declaredBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the metadata mismatch when transport cancellation also fails.
        }
        throw new InvalidLocalAudioResponseError(
          "The private local audio response length does not match its body.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== declaredBytes) {
    throw new InvalidLocalAudioResponseError(
      "The private local audio response length does not match its body.",
    );
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!isSyntheticWave(bytes)) {
    throw new InvalidLocalAudioResponseError(
      "The private local audio response is not a supported WAV file.",
    );
  }

  return new Blob([bytes], { type: "audio/wav" });
}
