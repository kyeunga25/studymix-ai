import { AwsClient } from "aws4fetch";
import { z } from "zod";

const accountIdSchema = z.string().regex(/^[0-9a-f]{32}$/i);
const bucketNameSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/);
const credentialSchema = z.string().trim().min(16).max(512);
const objectKeySchema = z
  .string()
  .regex(
    /^owners\/own_[0-9a-f]{32}\/(?:uploads\/upl_[0-9a-f]{32}\/source|outputs\/out_[0-9a-f]{32}\/candidate)$/,
  );

export const maximumSignedR2UrlTtlSeconds = 3_600;

export class R2TransferDisabledError extends Error {
  constructor() {
    super("Private object transfer is disabled.");
    this.name = "R2TransferDisabledError";
  }
}

export class R2TransferConfigurationError extends Error {
  constructor() {
    super("Private object transfer is not configured.");
    this.name = "R2TransferConfigurationError";
  }
}

export class R2TransferResourceExpiredError extends Error {
  constructor() {
    super("The private object capability has expired.");
    this.name = "R2TransferResourceExpiredError";
  }
}

export type R2TransferConfiguration = {
  accessKeyId: string;
  accountId: string;
  bucketName: string;
  downloadUrlTtlSeconds: number;
  maxActiveUploads: number;
  maxUploadBytes: number;
  secretAccessKey: string;
  uploadUrlTtlSeconds: number;
};

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new R2TransferConfigurationError();
  }
  return parsed;
}

export function resolveMaxUploadBytes(env: Env): number {
  return parseInteger(env.MAX_UPLOAD_BYTES, 1, 524_288_000);
}

export function resolveMaxActiveUploads(env: Env): number {
  return parseInteger(env.MAX_ACTIVE_UPLOADS_PER_OWNER, 1, 20);
}

export function resolveR2TransferConfiguration(env: Env): R2TransferConfiguration {
  if (env.R2_TRANSFER_ENABLED !== "true") {
    throw new R2TransferDisabledError();
  }

  const parsed = z
    .object({
      accessKeyId: credentialSchema,
      accountId: accountIdSchema,
      bucketName: bucketNameSchema,
      secretAccessKey: credentialSchema,
    })
    .safeParse({
      accessKeyId: env.R2_S3_ACCESS_KEY_ID,
      accountId: env.R2_ACCOUNT_ID,
      bucketName: env.R2_BUCKET_NAME,
      secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
    });

  if (!parsed.success) {
    throw new R2TransferConfigurationError();
  }

  return {
    ...parsed.data,
    downloadUrlTtlSeconds: parseInteger(
      env.DOWNLOAD_URL_TTL_SECONDS,
      1,
      maximumSignedR2UrlTtlSeconds,
    ),
    maxActiveUploads: resolveMaxActiveUploads(env),
    maxUploadBytes: resolveMaxUploadBytes(env),
    uploadUrlTtlSeconds: parseInteger(env.UPLOAD_URL_TTL_SECONDS, 1, maximumSignedR2UrlTtlSeconds),
  };
}

export function isR2TransferAvailable(env: Env): boolean {
  try {
    resolveR2TransferConfiguration(env);
    return true;
  } catch {
    return false;
  }
}

function awsDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function objectUrl(configuration: R2TransferConfiguration, objectKey: string): string {
  const encodedKey = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://${configuration.accountId}.r2.cloudflarestorage.com/${configuration.bucketName}/${encodedKey}`;
}

export async function createSignedR2ObjectUrl(
  input:
    | {
        configuration: R2TransferConfiguration;
        method: "GET";
        now: Date;
        objectKey: string;
        resourceExpiresAt: Date;
      }
    | {
        configuration: R2TransferConfiguration;
        contentLength: number;
        contentType: string;
        method: "PUT";
        now: Date;
        objectKey: string;
      },
): Promise<{ expiresAt: string; url: string }> {
  const { configuration, method, now, objectKey } = input;
  const parsedObjectKey = objectKeySchema.parse(objectKey);
  const remainingSeconds =
    method === "GET"
      ? Math.floor((input.resourceExpiresAt.getTime() - now.getTime()) / 1_000)
      : configuration.uploadUrlTtlSeconds;
  if (!Number.isSafeInteger(remainingSeconds) || remainingSeconds < 1) {
    throw new R2TransferResourceExpiredError();
  }
  const ttlSeconds =
    method === "PUT"
      ? configuration.uploadUrlTtlSeconds
      : Math.min(configuration.downloadUrlTtlSeconds, remainingSeconds);
  const headers = new Headers();
  if (input.method === "PUT") {
    const contentLength = z
      .number()
      .int()
      .positive()
      .safe()
      .max(configuration.maxUploadBytes)
      .parse(input.contentLength);
    headers.set("Content-Length", contentLength.toString());
    headers.set("Content-Type", input.contentType);
    headers.set("If-None-Match", "*");
  }

  const client = new AwsClient({
    accessKeyId: configuration.accessKeyId,
    region: "auto",
    secretAccessKey: configuration.secretAccessKey,
    service: "s3",
  });
  const request = await client.sign(
    new Request(
      `${objectUrl(configuration, parsedObjectKey)}?X-Amz-Expires=${ttlSeconds.toString()}`,
      { headers, method },
    ),
    {
      aws: {
        allHeaders: true,
        datetime: awsDate(now),
        signQuery: true,
      },
    },
  );

  return {
    expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
    url: request.url,
  };
}
