export type AudioPlaybackMetadata = {
  durationSeconds: number;
};

export type AudioPlaybackMetadataErrorReason = "invalid-duration" | "timeout" | "unreadable";

export class AudioPlaybackMetadataError extends Error {
  readonly reason: AudioPlaybackMetadataErrorReason;

  constructor(reason: AudioPlaybackMetadataErrorReason) {
    super("The browser could not read valid playback metadata from the selected audio file.");
    this.name = "AudioPlaybackMetadataError";
    this.reason = reason;
  }
}

const metadataTimeoutMilliseconds = 8_000;

function abortReason(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new DOMException("The audio metadata check was cancelled.", "AbortError");
}

export async function inspectAudioPlaybackMetadata(
  file: File,
  signal?: AbortSignal,
): Promise<AudioPlaybackMetadata> {
  signal?.throwIfAborted();

  const audio = document.createElement("audio");
  const objectUrl = URL.createObjectURL(file);

  return await new Promise<AudioPlaybackMetadata>((resolve, reject) => {
    let metadataObserved = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", handleAbort);
      audio.removeEventListener("durationchange", handleMetadata);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("loadedmetadata", handleMetadata);
      try {
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // URL revocation below is the required cleanup if media reset is unavailable.
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    const settle = (result: { metadata: AudioPlaybackMetadata } | { error: unknown }): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if ("metadata" in result) {
        resolve(result.metadata);
      } else {
        reject(result.error);
      }
    };

    function handleAbort(): void {
      if (signal !== undefined) {
        settle({ error: abortReason(signal) });
      }
    }

    function handleMetadata(): void {
      metadataObserved = true;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        settle({ metadata: { durationSeconds: audio.duration } });
      }
    }

    function handleError(): void {
      settle({ error: new AudioPlaybackMetadataError("unreadable") });
    }

    audio.addEventListener("durationchange", handleMetadata);
    audio.addEventListener("error", handleError);
    audio.addEventListener("loadedmetadata", handleMetadata);
    signal?.addEventListener("abort", handleAbort, { once: true });
    timeout = setTimeout(() => {
      settle({
        error: new AudioPlaybackMetadataError(metadataObserved ? "invalid-duration" : "timeout"),
      });
    }, metadataTimeoutMilliseconds);

    try {
      audio.preload = "metadata";
      audio.src = objectUrl;
      audio.load();
    } catch {
      settle({ error: new AudioPlaybackMetadataError("unreadable") });
    }
  });
}
