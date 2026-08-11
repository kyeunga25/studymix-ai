import { jobIdSchema } from "@studymix/contracts";

type SessionStorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export const activePrivateJobSessionKey = "studymix.active-private-job.v1";

function resolveSessionStorage(storage?: SessionStorageLike): SessionStorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearRememberedPrivateJob(storage?: SessionStorageLike): boolean {
  const resolvedStorage = resolveSessionStorage(storage);
  if (resolvedStorage === null) {
    return false;
  }
  try {
    resolvedStorage.removeItem(activePrivateJobSessionKey);
    return resolvedStorage.getItem(activePrivateJobSessionKey) === null;
  } catch {
    return false;
  }
}

export function readRememberedPrivateJobId(storage?: SessionStorageLike): string | null {
  const resolvedStorage = resolveSessionStorage(storage);
  if (resolvedStorage === null) {
    return null;
  }
  try {
    const value = resolvedStorage.getItem(activePrivateJobSessionKey);
    const parsed = jobIdSchema.safeParse(value);
    if (!parsed.success) {
      if (value !== null) {
        resolvedStorage.removeItem(activePrivateJobSessionKey);
      }
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function rememberPrivateJobId(jobId: string, storage?: SessionStorageLike): boolean {
  const resolvedStorage = resolveSessionStorage(storage);
  const parsed = jobIdSchema.safeParse(jobId);
  if (resolvedStorage === null) {
    return false;
  }
  if (!parsed.success) {
    clearRememberedPrivateJob(resolvedStorage);
    return false;
  }
  try {
    resolvedStorage.setItem(activePrivateJobSessionKey, parsed.data);
    if (resolvedStorage.getItem(activePrivateJobSessionKey) !== parsed.data) {
      clearRememberedPrivateJob(resolvedStorage);
      return false;
    }
    return true;
  } catch {
    clearRememberedPrivateJob(resolvedStorage);
    return false;
  }
}
