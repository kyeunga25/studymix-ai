import { inspectAudioContainer, type AudioContainerInspection } from "@studymix/core";
import type { AudioContentType } from "@studymix/contracts";

export class AudioObjectInspectionUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The private audio object could not be inspected consistently.", options);
    this.name = "AudioObjectInspectionUnavailableError";
  }
}

const R2_INSPECTION_PAGE_BYTES = 65_536;
const MAX_R2_INSPECTION_PAGE_READS = 32;
const MAX_CACHED_R2_INSPECTION_PAGES = 4;

function hasObjectBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return "body" in object;
}

export async function inspectR2AudioObject({
  bucket,
  contentType,
  etag,
  objectKey,
  sizeBytes,
}: {
  bucket: R2Bucket;
  contentType: AudioContentType;
  etag: string;
  objectKey: string;
  sizeBytes: number;
}): Promise<AudioContainerInspection> {
  const pageCache = new Map<number, Uint8Array>();
  let pageReads = 0;

  const readPage = async (pageOffset: number): Promise<Uint8Array | null> => {
    const cached = pageCache.get(pageOffset);
    if (cached !== undefined) {
      pageCache.delete(pageOffset);
      pageCache.set(pageOffset, cached);
      return cached;
    }
    if (pageReads >= MAX_R2_INSPECTION_PAGE_READS) {
      return null;
    }
    const pageLength = Math.min(R2_INSPECTION_PAGE_BYTES, sizeBytes - pageOffset);
    pageReads += 1;
    const object = await bucket.get(objectKey, {
      onlyIf: { etagMatches: etag },
      range: { length: pageLength, offset: pageOffset },
    });
    if (object === null || !hasObjectBody(object)) {
      throw new AudioObjectInspectionUnavailableError();
    }
    const bytes = await object.bytes();
    if (bytes.byteLength !== pageLength) {
      throw new AudioObjectInspectionUnavailableError();
    }
    if (pageCache.size >= MAX_CACHED_R2_INSPECTION_PAGES) {
      const oldestPageOffset = pageCache.keys().next().value;
      if (oldestPageOffset !== undefined) {
        pageCache.delete(oldestPageOffset);
      }
    }
    pageCache.set(pageOffset, bytes);
    return bytes;
  };

  try {
    return await inspectAudioContainer({
      contentType,
      read: async (offset, length) => {
        const result = new Uint8Array(length);
        const end = offset + length;
        let cursor = offset;
        while (cursor < end) {
          const pageOffset =
            Math.floor(cursor / R2_INSPECTION_PAGE_BYTES) * R2_INSPECTION_PAGE_BYTES;
          const page = await readPage(pageOffset);
          if (page === null) {
            return new Uint8Array();
          }
          const pageCursor = cursor - pageOffset;
          const copyLength = Math.min(page.byteLength - pageCursor, end - cursor);
          if (copyLength < 1) {
            return new Uint8Array();
          }
          result.set(page.subarray(pageCursor, pageCursor + copyLength), cursor - offset);
          cursor += copyLength;
        }
        return result;
      },
      sizeBytes,
    });
  } catch (error) {
    if (error instanceof AudioObjectInspectionUnavailableError) {
      throw error;
    }
    throw new AudioObjectInspectionUnavailableError({ cause: error });
  }
}
