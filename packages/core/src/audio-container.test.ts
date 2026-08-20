import type { AudioContentType } from "@studymix/contracts";
import { describe, expect, it } from "vitest";
import { inspectAudioContainer, type AudioContainerFormat } from "./audio-container";

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function writeUint16Le(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function writeUint32Le(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function waveFixture(): Uint8Array {
  const bytes = new Uint8Array(60);
  writeAscii(bytes, 0, "RIFF");
  writeUint32Le(bytes, 4, bytes.byteLength - 8);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  writeUint32Le(bytes, 16, 16);
  writeUint16Le(bytes, 20, 1);
  writeUint16Le(bytes, 22, 1);
  writeUint32Le(bytes, 24, 8_000);
  writeUint32Le(bytes, 28, 16_000);
  writeUint16Le(bytes, 32, 2);
  writeUint16Le(bytes, 34, 16);
  writeAscii(bytes, 36, "data");
  writeUint32Le(bytes, 40, 16);
  return bytes;
}

function mp3Fixture(): Uint8Array {
  const frameLength = 417;
  const bytes = new Uint8Array(frameLength * 2);
  const header = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
  bytes.set(header, 0);
  bytes.set(header, frameLength);
  return bytes;
}

function aacFixture(): Uint8Array {
  const frameLength = 20;
  const bytes = new Uint8Array(frameLength * 2);
  const header = new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0x02, 0x9f, 0xfc]);
  bytes.set(header, 0);
  bytes.set(header, frameLength);
  return bytes;
}

function oggOpusFixture(): Uint8Array {
  const packetLength = 19;
  const bytes = new Uint8Array(27 + 1 + packetLength);
  writeAscii(bytes, 0, "OggS");
  bytes[5] = 0x02;
  bytes[26] = 1;
  bytes[27] = packetLength;
  writeAscii(bytes, 28, "OpusHead");
  bytes[36] = 1;
  bytes[37] = 2;
  return bytes;
}

function isoBox(type: string, content: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + content.byteLength);
  writeUint32Be(bytes, 0, bytes.byteLength);
  writeAscii(bytes, 4, type);
  bytes.set(content, 8);
  return bytes;
}

function m4aFixture(handlerType = "soun"): Uint8Array {
  const ftypContent = new Uint8Array(16);
  writeAscii(ftypContent, 0, "M4A ");
  writeAscii(ftypContent, 8, "isom");
  writeAscii(ftypContent, 12, "M4A ");

  const handlerContent = new Uint8Array(24);
  writeAscii(handlerContent, 8, handlerType);
  const handler = isoBox("hdlr", handlerContent);
  const media = isoBox("mdia", handler);
  const track = isoBox("trak", media);
  const movie = isoBox("moov", track);
  return concatenate([isoBox("ftyp", ftypContent), movie]);
}

const supportedFixtures = [
  { bytes: mp3Fixture(), contentType: "audio/mpeg", format: "mp3" },
  { bytes: waveFixture(), contentType: "audio/wav", format: "wav" },
  { bytes: waveFixture(), contentType: "audio/x-wav", format: "wav" },
  { bytes: m4aFixture(), contentType: "audio/mp4", format: "m4a" },
  { bytes: aacFixture(), contentType: "audio/aac", format: "aac-adts" },
  { bytes: oggOpusFixture(), contentType: "audio/ogg", format: "ogg-opus" },
] satisfies readonly Readonly<{
  bytes: Uint8Array;
  contentType: AudioContentType;
  format: AudioContainerFormat;
}>[];

async function inspect(bytes: Uint8Array, contentType: AudioContentType) {
  return await inspectAudioContainer({
    contentType,
    read: async (offset, length) => bytes.slice(offset, offset + length),
    sizeBytes: bytes.byteLength,
  });
}

describe("bounded audio container inspection", () => {
  it.each(supportedFixtures)(
    "recognizes $format structure",
    async ({ bytes, contentType, format }) => {
      await expect(inspect(bytes, contentType)).resolves.toEqual({ format, valid: true });
    },
  );

  it("rejects a declared type that does not match the container", async () => {
    await expect(inspect(waveFixture(), "audio/mpeg")).resolves.toEqual({
      format: null,
      valid: false,
    });
    await expect(inspect(m4aFixture("vide"), "audio/mp4")).resolves.toEqual({
      format: null,
      valid: false,
    });
  });

  it("rejects truncated and marker-only files", async () => {
    await expect(inspect(new TextEncoder().encode("RIFF....WAVE"), "audio/wav")).resolves.toEqual({
      format: null,
      valid: false,
    });
    await expect(inspect(new TextEncoder().encode("OggS"), "audio/ogg")).resolves.toEqual({
      format: null,
      valid: false,
    });
  });

  it("uses only exact bounded ranges instead of buffering the whole file", async () => {
    const bytes = new Uint8Array(65_536);
    bytes.set(mp3Fixture(), 0);
    const ranges: { length: number; offset: number }[] = [];
    const result = await inspectAudioContainer({
      contentType: "audio/mpeg",
      read: async (offset, length) => {
        ranges.push({ length, offset });
        return bytes.slice(offset, offset + length);
      },
      sizeBytes: 524_288_000,
    });

    expect(result).toEqual({ format: "mp3", valid: true });
    expect(ranges.reduce((total, range) => total + range.length, 0)).toBeLessThanOrEqual(65_550);
    expect(Math.max(...ranges.map((range) => range.length))).toBeLessThanOrEqual(65_536);
  });

  it("stops malformed box walks within the inspection budget", async () => {
    const freeBox = isoBox("free", new Uint8Array());
    const bytes = concatenate(Array.from({ length: 600 }, () => freeBox));
    let readCalls = 0;
    const result = await inspectAudioContainer({
      contentType: "audio/mp4",
      read: async (offset, length) => {
        readCalls += 1;
        return bytes.slice(offset, offset + length);
      },
      sizeBytes: bytes.byteLength,
    });

    expect(result).toEqual({ format: null, valid: false });
    expect(readCalls).toBeLessThanOrEqual(512);
  });

  it("propagates reader failures so callers can preserve retryable state", async () => {
    const readFailure = new Error("Synthetic bounded reader failure.");
    await expect(
      inspectAudioContainer({
        contentType: "audio/wav",
        read: async () => {
          throw readFailure;
        },
        sizeBytes: 60,
      }),
    ).rejects.toBe(readFailure);
  });
});
