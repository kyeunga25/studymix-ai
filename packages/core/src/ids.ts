export const resourceIdPrefixes = ["own", "upl", "job", "out", "rgt", "req"] as const;

export type ResourceIdPrefix = (typeof resourceIdPrefixes)[number];
export type SecureResourceId<TPrefix extends ResourceIdPrefix = ResourceIdPrefix> =
  `${TPrefix}_${string}`;

const RANDOM_BYTE_COUNT = 16;
const SECURE_ID_PATTERN = /^[a-z][a-z0-9]{1,15}_[0-9a-f]{32}$/;

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSecureId<TPrefix extends ResourceIdPrefix>(
  prefix: TPrefix,
): SecureResourceId<TPrefix> {
  if (!resourceIdPrefixes.includes(prefix)) {
    throw new TypeError(`Unsupported resource ID prefix: ${String(prefix)}`);
  }

  return `${prefix}_${bytesToHex(randomBytes(RANDOM_BYTE_COUNT))}`;
}

export function isSecureId<TPrefix extends ResourceIdPrefix>(
  value: string,
  prefix: TPrefix,
): value is SecureResourceId<TPrefix> {
  return value.startsWith(`${prefix}_`) && SECURE_ID_PATTERN.test(value);
}
