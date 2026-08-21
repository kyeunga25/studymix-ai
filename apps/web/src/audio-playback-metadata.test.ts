import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectAudioPlaybackMetadata } from "./audio-playback-metadata";

type AudioEventName = "durationchange" | "error" | "loadedmetadata";

class FakeAudioElement {
  duration = Number.NaN;
  preload = "none";
  src = "";
  readonly load = vi.fn();
  readonly removeAttribute = vi.fn((name: string) => {
    if (name === "src") {
      this.src = "";
    }
  });
  private readonly listeners = new Map<AudioEventName, Set<EventListener>>();

  addEventListener(name: AudioEventName, listener: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: AudioEventName, listener: EventListener): void {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name: AudioEventName): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new Event(name));
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

describe("browser-local audio playback metadata inspection", () => {
  let audio: FakeAudioElement;
  let createObjectUrl: ReturnType<typeof vi.fn>;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    audio = new FakeAudioElement();
    createObjectUrl = vi.fn(() => "blob:synthetic-audio");
    revokeObjectUrl = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => audio),
    });
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function file(): File {
    return new File([new Uint8Array([1, 2, 3])], "synthetic.wav", { type: "audio/wav" });
  }

  function expectCleanedUp(): void {
    expect(audio.listenerCount()).toBe(0);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:synthetic-audio");
  }

  it("accepts a finite positive duration and releases the transient object URL", async () => {
    const result = inspectAudioPlaybackMetadata(file());
    audio.duration = 61.25;
    audio.emit("loadedmetadata");

    await expect(result).resolves.toEqual({ durationSeconds: 61.25 });
    expect(audio.preload).toBe("metadata");
    expectCleanedUp();
  });

  it("waits for a finite duration after an initial streaming-style Infinity value", async () => {
    const result = inspectAudioPlaybackMetadata(file());
    audio.duration = Number.POSITIVE_INFINITY;
    audio.emit("loadedmetadata");
    audio.duration = 2.5;
    audio.emit("durationchange");

    await expect(result).resolves.toEqual({ durationSeconds: 2.5 });
    expectCleanedUp();
  });

  it("rejects a browser decoding error and releases all local resources", async () => {
    const result = inspectAudioPlaybackMetadata(file());
    audio.emit("error");

    await expect(result).rejects.toMatchObject({
      name: "AudioPlaybackMetadataError",
      reason: "unreadable",
    });
    expectCleanedUp();
  });

  it("maps a synchronous media-load failure to an unreadable result", async () => {
    audio.load.mockImplementationOnce(() => {
      throw new Error("Synthetic media load failure");
    });

    await expect(inspectAudioPlaybackMetadata(file())).rejects.toMatchObject({
      reason: "unreadable",
    });
    expectCleanedUp();
  });

  it("still revokes the object URL when media reset is unavailable", async () => {
    audio.load
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("Synthetic media reset failure");
      });
    const result = inspectAudioPlaybackMetadata(file());
    audio.duration = 3;
    audio.emit("loadedmetadata");

    await expect(result).resolves.toEqual({ durationSeconds: 3 });
    expectCleanedUp();
  });

  it("rejects observed metadata without a finite positive duration", async () => {
    const result = inspectAudioPlaybackMetadata(file());
    const rejection = expect(result).rejects.toMatchObject({ reason: "invalid-duration" });
    audio.duration = Number.NaN;
    audio.emit("loadedmetadata");
    await vi.advanceTimersByTimeAsync(8_000);

    await rejection;
    expectCleanedUp();
  });

  it("times out when the browser emits no metadata event", async () => {
    const result = inspectAudioPlaybackMetadata(file());
    const rejection = expect(result).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(8_000);

    await rejection;
    expectCleanedUp();
  });

  it("stops an active inspection and releases the object URL when aborted", async () => {
    const controller = new AbortController();
    const result = inspectAudioPlaybackMetadata(file(), controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expectCleanedUp();
  });

  it("does not allocate browser resources when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(inspectAudioPlaybackMetadata(file(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(audio.load).not.toHaveBeenCalled();
  });
});
