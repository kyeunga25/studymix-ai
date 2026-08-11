const r2AccountHostnamePattern = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/;
const r2BucketNamePattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const r2ObjectKeyPatterns = {
  output: /^owners\/own_[0-9a-f]{32}\/outputs\/(out_[0-9a-f]{32})\/candidate$/,
  upload: /^owners\/own_[0-9a-f]{32}\/uploads\/(upl_[0-9a-f]{32})\/source$/,
} as const;
const requiredQueryParameters = [
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Signature",
  "X-Amz-SignedHeaders",
] as const;
const credentialScopeSuffix = "/auto/s3/aws4_request";
const maximumFutureClockSkewMilliseconds = 5 * 60 * 1_000;

type R2PresignedInstruction =
  | {
      kind: "output";
      expiresAt: string;
      resourceId: string;
      url: string;
    }
  | {
      expiresAt: string;
      kind: "upload";
      objectKey: string;
      resourceId: string;
      url: string;
    };

function awsSigningTimestamp(value: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const normalized = new Date(timestamp).toISOString().replace(/[:-]|\.\d{3}/g, "");
  return normalized === value ? timestamp : null;
}

function hasCoherentLifetime({
  credential,
  declaredExpiresAt,
  expiresSeconds,
  now,
  signingDate,
}: {
  credential: string;
  declaredExpiresAt: string;
  expiresSeconds: number;
  now: number;
  signingDate: string;
}): boolean {
  const signingTimestamp = awsSigningTimestamp(signingDate);
  const declaredExpiryTimestamp = Date.parse(declaredExpiresAt);
  const credentialMatch = /^([^/]+)\/(\d{8})\/auto\/s3\/aws4_request$/.exec(credential);
  if (
    signingTimestamp === null ||
    !Number.isFinite(declaredExpiryTimestamp) ||
    credentialMatch?.[1] === undefined ||
    credentialMatch[1].length < 16 ||
    credentialMatch[2] !== signingDate.slice(0, 8)
  ) {
    return false;
  }

  const expectedExpiryTimestamp = signingTimestamp + expiresSeconds * 1_000;
  const signingPrecisionDifference = declaredExpiryTimestamp - expectedExpiryTimestamp;
  return (
    signingTimestamp <= now + maximumFutureClockSkewMilliseconds &&
    declaredExpiryTimestamp > now &&
    signingPrecisionDifference >= 0 &&
    signingPrecisionDifference < 1_000
  );
}

function objectKeyFromPath(pathname: string): string | null {
  const objectKeyStart = pathname.indexOf("/", 1);
  if (objectKeyStart < 2) {
    return null;
  }
  const bucketName = pathname.slice(1, objectKeyStart);
  const objectKey = pathname.slice(objectKeyStart + 1);
  return r2BucketNamePattern.test(bucketName) ? objectKey : null;
}

export function isTrustedR2PresignedUrl(instruction: R2PresignedInstruction): boolean {
  let instructionUrl: URL;
  try {
    instructionUrl = new URL(instruction.url);
  } catch {
    return false;
  }

  if (
    requiredQueryParameters.some(
      (parameter) => instructionUrl.searchParams.getAll(parameter).length !== 1,
    )
  ) {
    return false;
  }

  const objectKey = objectKeyFromPath(instructionUrl.pathname);
  if (objectKey === null) {
    return false;
  }
  const resourceMatch = r2ObjectKeyPatterns[instruction.kind].exec(objectKey);
  const credential = instructionUrl.searchParams.get("X-Amz-Credential") ?? "";
  const expires = instructionUrl.searchParams.get("X-Amz-Expires") ?? "";
  const expiresSeconds = Number(expires);
  const signingDate = instructionUrl.searchParams.get("X-Amz-Date") ?? "";
  const expectedSignedHeaders =
    instruction.kind === "upload" ? "content-length;content-type;host;if-none-match" : "host";

  return (
    instructionUrl.protocol === "https:" &&
    instructionUrl.port === "" &&
    instructionUrl.username === "" &&
    instructionUrl.password === "" &&
    instructionUrl.hash === "" &&
    r2AccountHostnamePattern.test(instructionUrl.hostname) &&
    resourceMatch?.[1] === instruction.resourceId &&
    (instruction.kind !== "upload" || objectKey === instruction.objectKey) &&
    instructionUrl.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" &&
    credential.length > credentialScopeSuffix.length &&
    credential.endsWith(credentialScopeSuffix) &&
    /^\d+$/.test(expires) &&
    Number.isSafeInteger(expiresSeconds) &&
    expiresSeconds >= 1 &&
    expiresSeconds <= 3_600 &&
    hasCoherentLifetime({
      credential,
      declaredExpiresAt: instruction.expiresAt,
      expiresSeconds,
      now: Date.now(),
      signingDate,
    }) &&
    /^[0-9a-f]{64}$/i.test(instructionUrl.searchParams.get("X-Amz-Signature") ?? "") &&
    instructionUrl.searchParams.get("X-Amz-SignedHeaders") === expectedSignedHeaders
  );
}
