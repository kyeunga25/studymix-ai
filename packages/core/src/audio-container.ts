import type { AudioContentType } from "@studymix/contracts";

export type AudioByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export type AudioContainerFormat =
  "aac-adts" | "m4a" | "mp3" | "ogg-opus" | "ogg-speex" | "ogg-vorbis" | "wav";

export type AudioContainerInspection =
  { format: AudioContainerFormat; valid: true } | { format: null; valid: false };

export type InspectAudioContainerOptions = {
  contentType: AudioContentType;
  read: AudioByteReader;
  sizeBytes: number;
};

const MAX_READ_CALLS = 2_048;
const MAX_TOTAL_READ_BYTES = 262_144;
const MAX_SINGLE_READ_BYTES = 65_536;
const MAX_CONTAINER_BOXES = 512;
const MAX_WAVE_CHUNKS = 512;

type ExactAudioReader = (offset: number, length: number) => Promise<Uint8Array | null>;

function createExactReader({
  read,
  sizeBytes,
}: Pick<InspectAudioContainerOptions, "read" | "sizeBytes">): ExactAudioReader {
  let calls = 0;
  let totalBytes = 0;

  return async (offset, length) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      length > MAX_SINGLE_READ_BYTES ||
      offset > sizeBytes - length ||
      calls >= MAX_READ_CALLS ||
      totalBytes > MAX_TOTAL_READ_BYTES - length
    ) {
      return null;
    }

    calls += 1;
    totalBytes += length;
    const bytes = await read(offset, length);
    return bytes.byteLength === length ? bytes : null;
  };
}

function containsAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset < 0 || offset > bytes.byteLength - expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string | null {
  if (offset < 0 || length < 0 || offset > bytes.byteLength - length) {
    return null;
  }
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return null;
    value += String.fromCharCode(byte);
  }
  return value;
}

function uint16Le(bytes: Uint8Array, offset: number): number | null {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  return first === undefined || second === undefined ? null : first | (second << 8);
}

function uint32Le(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function uint32Be(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function uint64Be(bytes: Uint8Array, offset: number): number | null {
  const high = uint32Be(bytes, offset);
  const low = uint32Be(bytes, offset + 4);
  if (high === null || low === null || high > 0x1f_ffff) return null;
  const value = high * 0x1_0000_0000 + low;
  return Number.isSafeInteger(value) ? value : null;
}

async function id3PayloadEnd(read: ExactAudioReader, sizeBytes: number): Promise<number | null> {
  if (sizeBytes < 10) return 0;
  const header = await read(0, 10);
  if (header === null || !containsAscii(header, 0, "ID3")) return 0;

  const majorVersion = header[3];
  const flags = header[5];
  const size0 = header[6];
  const size1 = header[7];
  const size2 = header[8];
  const size3 = header[9];
  if (
    majorVersion === undefined ||
    majorVersion < 2 ||
    majorVersion > 4 ||
    flags === undefined ||
    size0 === undefined ||
    size1 === undefined ||
    size2 === undefined ||
    size3 === undefined ||
    [size0, size1, size2, size3].some((byte) => (byte & 0x80) !== 0)
  ) {
    return null;
  }

  const payloadSize = (size0 << 21) | (size1 << 14) | (size2 << 7) | size3;
  const footerSize = majorVersion === 4 && (flags & 0x10) !== 0 ? 10 : 0;
  const end = 10 + payloadSize + footerSize;
  return end <= sizeBytes ? end : null;
}

type Mp3Frame = {
  frameLength: number;
  sampleRate: number;
  versionBits: number;
};

function parseMp3Frame(bytes: Uint8Array, offset: number): Mp3Frame | null {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  if (first !== 0xff || second === undefined || third === undefined || (second & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  if (
    versionBits === 0x01 ||
    layerBits !== 0x01 ||
    bitrateIndex === 0 ||
    bitrateIndex === 0x0f ||
    sampleRateIndex === 0x03
  ) {
    return null;
  }

  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const baseSampleRates = [44_100, 48_000, 32_000];
  const bitrate = (versionBits === 0x03 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex];
  const baseSampleRate = baseSampleRates[sampleRateIndex];
  if (bitrate === undefined || baseSampleRate === undefined) return null;

  const sampleRate =
    versionBits === 0x03
      ? baseSampleRate
      : versionBits === 0x02
        ? baseSampleRate / 2
        : baseSampleRate / 4;
  const coefficient = versionBits === 0x03 ? 144 : 72;
  const padding = (third >> 1) & 0x01;
  const frameLength = Math.floor((coefficient * bitrate * 1_000) / sampleRate) + padding;
  return frameLength >= 24 ? { frameLength, sampleRate, versionBits } : null;
}

async function inspectMp3(read: ExactAudioReader, sizeBytes: number): Promise<boolean> {
  const audioStart = await id3PayloadEnd(read, sizeBytes);
  if (audioStart === null || audioStart > sizeBytes - 8) return false;

  const scanLength = Math.min(65_536, sizeBytes - audioStart);
  const scan = await read(audioStart, scanLength);
  if (scan === null) return false;

  for (let index = 0; index <= scan.byteLength - 4; index += 1) {
    const firstFrame = parseMp3Frame(scan, index);
    if (firstFrame === null) continue;
    const firstOffset = audioStart + index;
    const secondOffset = firstOffset + firstFrame.frameLength;
    if (secondOffset > sizeBytes - 4) continue;
    const secondHeader = await read(secondOffset, 4);
    if (secondHeader === null) return false;
    const secondFrame = parseMp3Frame(secondHeader, 0);
    if (
      secondFrame !== null &&
      secondFrame.versionBits === firstFrame.versionBits &&
      secondFrame.sampleRate === firstFrame.sampleRate
    ) {
      return true;
    }
  }
  return false;
}

async function inspectWave(read: ExactAudioReader, sizeBytes: number): Promise<boolean> {
  if (sizeBytes < 44) return false;
  const header = await read(0, 12);
  if (header === null || !containsAscii(header, 0, "RIFF") || !containsAscii(header, 8, "WAVE")) {
    return false;
  }
  const declaredPayloadSize = uint32Le(header, 4);
  if (declaredPayloadSize === null) return false;
  const declaredEnd = declaredPayloadSize + 8;
  if (declaredEnd < 44 || declaredEnd > sizeBytes) return false;

  let foundFormat = false;
  let foundData = false;
  let offset = 12;
  let chunks = 0;
  while (offset <= declaredEnd - 8 && chunks < MAX_WAVE_CHUNKS) {
    chunks += 1;
    const chunkHeader = await read(offset, 8);
    if (chunkHeader === null) return false;
    const chunkType = ascii(chunkHeader, 0, 4);
    const chunkSize = uint32Le(chunkHeader, 4);
    if (chunkType === null || chunkSize === null) return false;
    const contentOffset = offset + 8;
    const paddedSize = chunkSize + (chunkSize & 1);
    if (!Number.isSafeInteger(paddedSize) || contentOffset > declaredEnd - paddedSize) return false;

    if (chunkType === "fmt ") {
      if (chunkSize < 16) return false;
      const format = await read(contentOffset, 16);
      if (format === null) return false;
      const encoding = uint16Le(format, 0);
      const channels = uint16Le(format, 2);
      const sampleRate = uint32Le(format, 4);
      const byteRate = uint32Le(format, 8);
      const blockAlign = uint16Le(format, 12);
      if (
        encoding === null ||
        encoding === 0 ||
        channels === null ||
        channels < 1 ||
        channels > 64 ||
        sampleRate === null ||
        sampleRate < 1_000 ||
        sampleRate > 768_000 ||
        byteRate === null ||
        byteRate < 1 ||
        blockAlign === null ||
        blockAlign < 1
      ) {
        return false;
      }
      foundFormat = true;
    } else if (chunkType === "data" && chunkSize > 0) {
      foundData = true;
    }

    if (foundFormat && foundData) return true;
    offset = contentOffset + paddedSize;
  }
  return false;
}

type AdtsFrame = {
  channelConfiguration: number;
  frameLength: number;
  sampleRateIndex: number;
};

function parseAdtsFrame(header: Uint8Array): AdtsFrame | null {
  const first = header[0];
  const second = header[1];
  const third = header[2];
  const fourth = header[3];
  const fifth = header[4];
  const sixth = header[5];
  if (
    first !== 0xff ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined ||
    sixth === undefined ||
    (second & 0xf6) !== 0xf0
  ) {
    return null;
  }
  const sampleRateIndex = (third >> 2) & 0x0f;
  const channelConfiguration = ((third & 0x01) << 2) | (fourth >> 6);
  const headerLength = (second & 0x01) === 0 ? 9 : 7;
  const frameLength = ((fourth & 0x03) << 11) | (fifth << 3) | (sixth >> 5);
  if (
    sampleRateIndex > 12 ||
    channelConfiguration < 1 ||
    channelConfiguration > 7 ||
    frameLength < headerLength
  ) {
    return null;
  }
  return { channelConfiguration, frameLength, sampleRateIndex };
}

async function inspectAac(read: ExactAudioReader, sizeBytes: number): Promise<boolean> {
  const audioStart = await id3PayloadEnd(read, sizeBytes);
  if (audioStart === null || audioStart > sizeBytes - 14) return false;
  const firstHeader = await read(audioStart, 7);
  if (firstHeader === null) return false;
  const firstFrame = parseAdtsFrame(firstHeader);
  if (firstFrame === null) return false;
  const secondOffset = audioStart + firstFrame.frameLength;
  if (secondOffset > sizeBytes - 7) return false;
  const secondHeader = await read(secondOffset, 7);
  if (secondHeader === null) return false;
  const secondFrame = parseAdtsFrame(secondHeader);
  return (
    secondFrame !== null &&
    secondFrame.channelConfiguration === firstFrame.channelConfiguration &&
    secondFrame.sampleRateIndex === firstFrame.sampleRateIndex
  );
}

async function inspectOgg(
  read: ExactAudioReader,
  sizeBytes: number,
): Promise<AudioContainerFormat | null> {
  if (sizeBytes < 28) return null;
  const header = await read(0, 27);
  if (
    header === null ||
    !containsAscii(header, 0, "OggS") ||
    header[4] !== 0 ||
    ((header[5] ?? 0) & 0x02) === 0
  ) {
    return null;
  }
  const segmentCount = header[26];
  if (segmentCount === undefined || segmentCount < 1) return null;
  const segments = await read(27, segmentCount);
  if (segments === null) return null;

  let packetLength = 0;
  let packetComplete = false;
  for (const segmentLength of segments) {
    packetLength += segmentLength;
    if (segmentLength < 255) {
      packetComplete = true;
      break;
    }
  }
  const packetOffset = 27 + segmentCount;
  if (
    !packetComplete ||
    packetLength < 8 ||
    packetLength > 8_192 ||
    packetOffset > sizeBytes - packetLength
  ) {
    return null;
  }
  const packet = await read(packetOffset, packetLength);
  if (packet === null) return null;

  if (packetLength >= 19 && containsAscii(packet, 0, "OpusHead") && (packet[9] ?? 0) > 0) {
    return "ogg-opus";
  }
  if (
    packetLength >= 30 &&
    packet[0] === 1 &&
    containsAscii(packet, 1, "vorbis") &&
    (packet[11] ?? 0) > 0 &&
    (uint32Le(packet, 12) ?? 0) > 0
  ) {
    return "ogg-vorbis";
  }
  if (
    packetLength >= 80 &&
    containsAscii(packet, 0, "Speex   ") &&
    (uint32Le(packet, 36) ?? 0) > 0 &&
    (uint32Le(packet, 48) ?? 0) > 0
  ) {
    return "ogg-speex";
  }
  return null;
}

type IsoBox = {
  contentOffset: number;
  end: number;
  type: string;
};

async function readIsoBox(
  read: ExactAudioReader,
  offset: number,
  parentEnd: number,
): Promise<IsoBox | null> {
  if (offset > parentEnd - 8) return null;
  const header = await read(offset, 8);
  if (header === null) return null;
  const size32 = uint32Be(header, 0);
  const type = ascii(header, 4, 4);
  if (size32 === null || type === null) return null;

  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    const extended = await read(offset + 8, 8);
    if (extended === null) return null;
    const extendedSize = uint64Be(extended, 0);
    if (extendedSize === null) return null;
    headerSize = 16;
    size = extendedSize;
  } else if (size32 === 0) {
    size = parentEnd - offset;
  }
  if (size < headerSize || size > parentEnd - offset) return null;
  const end = offset + size;
  return end > offset ? { contentOffset: offset + headerSize, end, type } : null;
}

async function mediaBoxHasAudioHandler(
  read: ExactAudioReader,
  contentOffset: number,
  end: number,
  budget: { boxes: number },
): Promise<boolean> {
  let offset = contentOffset;
  while (offset <= end - 8 && budget.boxes < MAX_CONTAINER_BOXES) {
    budget.boxes += 1;
    const box = await readIsoBox(read, offset, end);
    if (box === null) return false;
    if (box.type === "hdlr") {
      if (box.contentOffset > box.end - 12) return false;
      const handler = await read(box.contentOffset, 12);
      return handler !== null && containsAscii(handler, 8, "soun");
    }
    offset = box.end;
  }
  return false;
}

async function trackBoxHasAudioHandler(
  read: ExactAudioReader,
  contentOffset: number,
  end: number,
  budget: { boxes: number },
): Promise<boolean> {
  let offset = contentOffset;
  while (offset <= end - 8 && budget.boxes < MAX_CONTAINER_BOXES) {
    budget.boxes += 1;
    const box = await readIsoBox(read, offset, end);
    if (box === null) return false;
    if (
      box.type === "mdia" &&
      (await mediaBoxHasAudioHandler(read, box.contentOffset, box.end, budget))
    ) {
      return true;
    }
    offset = box.end;
  }
  return false;
}

async function movieBoxHasAudioTrack(
  read: ExactAudioReader,
  contentOffset: number,
  end: number,
  budget: { boxes: number },
): Promise<boolean> {
  let offset = contentOffset;
  while (offset <= end - 8 && budget.boxes < MAX_CONTAINER_BOXES) {
    budget.boxes += 1;
    const box = await readIsoBox(read, offset, end);
    if (box === null) return false;
    if (
      box.type === "trak" &&
      (await trackBoxHasAudioHandler(read, box.contentOffset, box.end, budget))
    ) {
      return true;
    }
    offset = box.end;
  }
  return false;
}

const isoAudioBrands = new Set(["M4A ", "M4B ", "M4P ", "isom", "iso2", "mp41", "mp42", "qt  "]);

async function inspectM4a(read: ExactAudioReader, sizeBytes: number): Promise<boolean> {
  if (sizeBytes < 32) return false;
  const budget = { boxes: 0 };
  let hasCompatibleBrand = false;
  let hasAudioTrack = false;
  let offset = 0;
  while (offset <= sizeBytes - 8 && budget.boxes < MAX_CONTAINER_BOXES) {
    budget.boxes += 1;
    const box = await readIsoBox(read, offset, sizeBytes);
    if (box === null) return false;
    if (box.type === "ftyp") {
      const contentLength = box.end - box.contentOffset;
      if (contentLength < 8 || contentLength > 4_096 || contentLength % 4 !== 0) return false;
      const brands = await read(box.contentOffset, contentLength);
      if (brands === null) return false;
      for (let brandOffset = 0; brandOffset <= brands.byteLength - 4; brandOffset += 4) {
        const brand = ascii(brands, brandOffset, 4);
        if (brand !== null && isoAudioBrands.has(brand)) {
          hasCompatibleBrand = true;
          break;
        }
      }
    } else if (
      box.type === "moov" &&
      (await movieBoxHasAudioTrack(read, box.contentOffset, box.end, budget))
    ) {
      hasAudioTrack = true;
    }
    if (hasCompatibleBrand && hasAudioTrack) return true;
    offset = box.end;
  }
  return false;
}

export async function inspectAudioContainer({
  contentType,
  read: unboundedRead,
  sizeBytes,
}: InspectAudioContainerOptions): Promise<AudioContainerInspection> {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    return { format: null, valid: false };
  }
  const read = createExactReader({ read: unboundedRead, sizeBytes });

  switch (contentType) {
    case "audio/mpeg":
      return (await inspectMp3(read, sizeBytes))
        ? { format: "mp3", valid: true }
        : { format: null, valid: false };
    case "audio/wav":
    case "audio/x-wav":
      return (await inspectWave(read, sizeBytes))
        ? { format: "wav", valid: true }
        : { format: null, valid: false };
    case "audio/mp4":
      return (await inspectM4a(read, sizeBytes))
        ? { format: "m4a", valid: true }
        : { format: null, valid: false };
    case "audio/aac":
      return (await inspectAac(read, sizeBytes))
        ? { format: "aac-adts", valid: true }
        : { format: null, valid: false };
    case "audio/ogg": {
      const format = await inspectOgg(read, sizeBytes);
      return format === null ? { format: null, valid: false } : { format, valid: true };
    }
  }
}
