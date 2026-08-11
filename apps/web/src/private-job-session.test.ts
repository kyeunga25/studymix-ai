import { describe, expect, it } from "vitest";
import {
  activePrivateJobSessionKey,
  clearRememberedPrivateJob,
  readRememberedPrivateJobId,
  rememberPrivateJobId,
} from "./private-job-session";

const validJobId = `job_${"1".repeat(32)}`;
const replacementJobId = `job_${"2".repeat(32)}`;

function createStorage(initialValue: string | null = null) {
  const values = new Map<string, string>();
  if (initialValue !== null) {
    values.set(activePrivateJobSessionKey, initialValue);
  }
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("private job session reference", () => {
  it("remembers and clears only a validated opaque job ID", () => {
    const storage = createStorage();

    expect(rememberPrivateJobId(validJobId, storage)).toBe(true);
    expect(readRememberedPrivateJobId(storage)).toBe(validJobId);

    expect(clearRememberedPrivateJob(storage)).toBe(true);
    expect(readRememberedPrivateJobId(storage)).toBeNull();
  });

  it.each([
    ["a path suffix", `${validJobId}/output`],
    ["a query suffix", `${validJobId}?owner=other`],
    ["the wrong prefix", `out_${"1".repeat(32)}`],
    ["a short value", `job_${"1".repeat(31)}`],
  ])("rejects %s and clears a previous reference", (_caseName, invalidJobId) => {
    const storage = createStorage(validJobId);

    expect(rememberPrivateJobId(invalidJobId, storage)).toBe(false);
    expect(readRememberedPrivateJobId(storage)).toBeNull();
  });

  it("removes an invalid stored value before any API caller can use it", () => {
    const storage = createStorage("not-a-job-id");

    expect(readRememberedPrivateJobId(storage)).toBeNull();
    expect(storage.getItem(activePrivateJobSessionKey)).toBeNull();
  });

  it("clears a stale reference when a valid replacement write fails", () => {
    const storage = createStorage(validJobId);
    const rejectingReplacementStorage = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: () => {
        throw new DOMException("Synthetic replacement denial.", "QuotaExceededError");
      },
    };

    expect(rememberPrivateJobId(replacementJobId, rejectingReplacementStorage)).toBe(false);
    expect(readRememberedPrivateJobId(rejectingReplacementStorage)).toBeNull();
  });

  it("clears a stale reference when a replacement write is silently ignored", () => {
    const storage = createStorage(validJobId);
    const nonWritingReplacementStorage = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: () => undefined,
    };

    expect(rememberPrivateJobId(replacementJobId, nonWritingReplacementStorage)).toBe(false);
    expect(readRememberedPrivateJobId(nonWritingReplacementStorage)).toBeNull();
  });

  it("reports a rejected removal without claiming the stored reference was cleared", () => {
    const storage = createStorage(validJobId);
    const rejectingRemovalStorage = {
      getItem: storage.getItem,
      removeItem: () => {
        throw new DOMException("Synthetic removal denial.", "SecurityError");
      },
      setItem: storage.setItem,
    };

    expect(clearRememberedPrivateJob(rejectingRemovalStorage)).toBe(false);
    expect(readRememberedPrivateJobId(rejectingRemovalStorage)).toBe(validJobId);
  });

  it("does not report success when storage leaves the reference behind", () => {
    const storage = createStorage(validJobId);
    const nonRemovingStorage = {
      getItem: storage.getItem,
      removeItem: () => undefined,
      setItem: storage.setItem,
    };

    expect(clearRememberedPrivateJob(nonRemovingStorage)).toBe(false);
    expect(readRememberedPrivateJobId(nonRemovingStorage)).toBe(validJobId);
  });

  it("fails closed when browser storage access throws", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new DOMException("Synthetic storage denial.", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("Synthetic storage denial.", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Synthetic storage denial.", "SecurityError");
      },
    };

    expect(readRememberedPrivateJobId(unavailableStorage)).toBeNull();
    expect(rememberPrivateJobId(validJobId, unavailableStorage)).toBe(false);
    expect(clearRememberedPrivateJob(unavailableStorage)).toBe(false);
  });

  it("does not require session storage in a non-browser test runtime", () => {
    expect(readRememberedPrivateJobId()).toBeNull();
    expect(rememberPrivateJobId(validJobId)).toBe(false);
    expect(clearRememberedPrivateJob()).toBe(false);
  });
});
