import {
  audioContentTypeSchema,
  createJobRequestSchema,
  jobIdSchema,
  ownerIdSchema,
  publicJobSchema,
  type CreateJobRequest,
  type PublicJob,
} from "@studymix/contracts";
import { z } from "zod";
import { getOwnedJob, listOwnedOutputs } from "./repositories";
import {
  isR2TransferAvailable,
  resolveR2TransferConfiguration,
  type R2TransferConfiguration,
} from "./r2-transfer";

export class GenerationWorkflowDisabledError extends Error {
  constructor() {
    super("Generation Workflow is disabled.");
    this.name = "GenerationWorkflowDisabledError";
  }
}

export class GenerationWorkflowConfigurationError extends Error {
  constructor() {
    super("Generation Workflow is not configured.");
    this.name = "GenerationWorkflowConfigurationError";
  }
}

export const generationWorkflowPayloadSchema = z
  .object({
    jobId: jobIdSchema,
    ownerId: ownerIdSchema,
  })
  .strict();

export type GenerationWorkflowPayload = z.infer<typeof generationWorkflowPayloadSchema>;

type GenerationWorkflowBaseConfiguration = Readonly<{
  maxActiveJobs: number;
  maxDailyJobs: number;
  outputRetentionHours: number;
  workflow: Workflow<GenerationWorkflowPayload>;
}>;

export type FalGenerationConfiguration = Readonly<{
  credentials: string;
  maxOutputBytes: number;
  maxPollAttempts: number;
  outputExpirationSeconds: number;
  outputTimeoutMilliseconds: number;
  pollIntervalMilliseconds: number;
  queueStartTimeoutSeconds: number;
  rateLimiter: RateLimit;
  r2: R2TransferConfiguration;
  webhookUrl: string;
  webhookUserId: string;
}>;

export type GenerationWorkflowConfiguration =
  | (GenerationWorkflowBaseConfiguration & Readonly<{ provider: "mock" }>)
  | (GenerationWorkflowBaseConfiguration &
      Readonly<{ fal: FalGenerationConfiguration; provider: "fal" }>);

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GenerationWorkflowConfigurationError();
  }
  return parsed;
}

function resolveFalGenerationConfiguration(env: Env): FalGenerationConfiguration {
  const credentials = z
    .string()
    .trim()
    .min(20)
    .max(512)
    .refine((value) => !/^change[-_]?me/i.test(value))
    .safeParse(env.FAL_KEY);
  if (!credentials.success) {
    throw new GenerationWorkflowConfigurationError();
  }
  if (env.JOB_RATE_LIMITER === undefined) {
    throw new GenerationWorkflowConfigurationError();
  }
  const webhookUrl = z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.port === "" &&
        parsed.pathname === "/api/webhooks/fal" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        !parsed.hostname.toLowerCase().endsWith(".invalid")
      );
    })
    .safeParse(env.FAL_WEBHOOK_URL);
  const webhookUserId = z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine((value) => !/\p{Cc}/u.test(value))
    .refine((value) => !/^change[-_]?me/i.test(value))
    .safeParse(env.FAL_WEBHOOK_USER_ID);
  if (!webhookUrl.success || !webhookUserId.success) {
    throw new GenerationWorkflowConfigurationError();
  }

  let r2: R2TransferConfiguration;
  try {
    r2 = resolveR2TransferConfiguration(env);
  } catch {
    throw new GenerationWorkflowConfigurationError();
  }
  const queueStartTimeoutSeconds = parseInteger(env.FAL_QUEUE_START_TIMEOUT_SECONDS, 30, 3_600);
  if (r2.downloadUrlTtlSeconds < queueStartTimeoutSeconds + 60) {
    throw new GenerationWorkflowConfigurationError();
  }

  return {
    credentials: credentials.data,
    maxOutputBytes: parseInteger(env.MAX_PROVIDER_OUTPUT_BYTES, 1, 524_288_000),
    maxPollAttempts: parseInteger(env.FAL_MAX_POLL_ATTEMPTS, 1, 240),
    outputExpirationSeconds: parseInteger(env.FAL_OUTPUT_EXPIRATION_SECONDS, 300, 604_800),
    outputTimeoutMilliseconds: parseInteger(env.PROVIDER_OUTPUT_TIMEOUT_SECONDS, 5, 120) * 1_000,
    pollIntervalMilliseconds: parseInteger(env.FAL_POLL_INTERVAL_SECONDS, 2, 60) * 1_000,
    queueStartTimeoutSeconds,
    rateLimiter: env.JOB_RATE_LIMITER,
    r2,
    webhookUrl: webhookUrl.data,
    webhookUserId: webhookUserId.data,
  };
}

export function resolveGenerationWorkflowConfiguration(env: Env): GenerationWorkflowConfiguration {
  if (env.JOB_WORKFLOW_ENABLED !== "true") {
    throw new GenerationWorkflowDisabledError();
  }
  if (!isR2TransferAvailable(env) || env.GENERATION_WORKFLOW === undefined) {
    throw new GenerationWorkflowConfigurationError();
  }

  const base = {
    maxActiveJobs: parseInteger(env.MAX_ACTIVE_JOBS_PER_OWNER, 1, 20),
    maxDailyJobs: parseInteger(env.MAX_DAILY_JOBS_PER_OWNER, 1, 100),
    outputRetentionHours: parseInteger(env.OUTPUT_RETENTION_HOURS, 1, 720),
    workflow: env.GENERATION_WORKFLOW,
  };
  if (env.GENERATION_PROVIDER === "mock" && env.REAL_GENERATION_ENABLED === "false") {
    return { ...base, provider: "mock" };
  }
  if (env.GENERATION_PROVIDER === "fal" && env.REAL_GENERATION_ENABLED === "true") {
    return { ...base, fal: resolveFalGenerationConfiguration(env), provider: "fal" };
  }
  throw new GenerationWorkflowConfigurationError();
}

export async function isRealGenerationRequestWithinRateLimit(
  configuration: GenerationWorkflowConfiguration,
  ownerId: string,
  connectingIp: string | undefined,
): Promise<boolean> {
  if (configuration.provider !== "fal") {
    return true;
  }
  const parsedIp = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => !/\p{Cc}/u.test(value))
    .safeParse(connectingIp);
  if (!parsedIp.success) {
    return false;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsedIp.data));
  const ipHash = bytesToHex(new Uint8Array(digest));
  const [ownerOutcome, ipOutcome] = await Promise.all([
    configuration.fal.rateLimiter.limit({ key: `owner:${ownerId}` }),
    configuration.fal.rateLimiter.limit({ key: `ip:${ipHash}` }),
  ]);
  return ownerOutcome.success && ipOutcome.success;
}

export function isMockGenerationAvailable(env: Env): boolean {
  try {
    return resolveGenerationWorkflowConfiguration(env).provider === "mock";
  } catch {
    return false;
  }
}

export function isRealGenerationAvailable(env: Env): boolean {
  try {
    return resolveGenerationWorkflowConfiguration(env).provider === "fal";
  } catch {
    return false;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createJobRequestFingerprint(request: CreateJobRequest): Promise<string> {
  const parsed = createJobRequestSchema.parse(request);
  const canonical = JSON.stringify({
    candidateCount: parsed.candidateCount,
    presetId: parsed.presetId,
    presetVersion: parsed.presetVersion,
    rightsDeclarationVersion: parsed.rightsDeclarationVersion,
    uploadId: parsed.uploadId,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToHex(new Uint8Array(digest));
}

export async function getOwnedPublicJob(
  db: D1Database,
  ownerId: string,
  jobId: string,
): Promise<PublicJob | null> {
  const job = await getOwnedJob(db, ownerId, jobId);
  if (job === null) {
    return null;
  }
  const outputs = await listOwnedOutputs(db, ownerId, jobId);
  return publicJobSchema.parse({
    candidateCount: job.candidateCount,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    errorCode: job.errorCode,
    expiresAt: job.expiresAt,
    jobId: job.id,
    outputs: outputs.map((output) => ({
      candidateIndex: output.candidateIndex,
      contentType:
        output.contentType === null ? null : audioContentTypeSchema.parse(output.contentType),
      createdAt: output.createdAt,
      durationSeconds: output.durationSeconds,
      expiresAt: output.expiresAt,
      outputId: output.id,
      sizeBytes: output.sizeBytes,
      status: output.status,
    })),
    preset: { id: job.presetId, version: job.presetVersion },
    retryPermitted: false,
    status: job.status,
    updatedAt: job.updatedAt,
    uploadId: job.uploadId,
  });
}

export async function ensureWorkflowStarted(
  workflow: Workflow<GenerationWorkflowPayload>,
  payload: GenerationWorkflowPayload,
): Promise<void> {
  try {
    await workflow.create({ id: payload.jobId, params: payload });
  } catch (createError) {
    try {
      const existing = await workflow.get(payload.jobId);
      const status = await existing.status();
      if (status.status === "unknown") {
        throw createError;
      }
    } catch {
      throw createError;
    }
  }
}
