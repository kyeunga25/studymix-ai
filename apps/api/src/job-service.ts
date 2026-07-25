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
import { isR2TransferAvailable } from "./r2-transfer";

export class GenerationWorkflowDisabledError extends Error {
  constructor() {
    super("Mock generation Workflow is disabled.");
    this.name = "GenerationWorkflowDisabledError";
  }
}

export class GenerationWorkflowConfigurationError extends Error {
  constructor() {
    super("Mock generation Workflow is not configured.");
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

export type GenerationWorkflowConfiguration = Readonly<{
  maxActiveJobs: number;
  outputRetentionHours: number;
  workflow: Workflow<GenerationWorkflowPayload>;
}>;

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GenerationWorkflowConfigurationError();
  }
  return parsed;
}

export function resolveGenerationWorkflowConfiguration(env: Env): GenerationWorkflowConfiguration {
  if (env.JOB_WORKFLOW_ENABLED !== "true") {
    throw new GenerationWorkflowDisabledError();
  }
  if (
    env.GENERATION_PROVIDER !== "mock" ||
    env.REAL_GENERATION_ENABLED !== "false" ||
    !isR2TransferAvailable(env) ||
    env.GENERATION_WORKFLOW === undefined
  ) {
    throw new GenerationWorkflowConfigurationError();
  }

  return {
    maxActiveJobs: parseInteger(env.MAX_ACTIVE_JOBS_PER_OWNER, 1, 20),
    outputRetentionHours: parseInteger(env.OUTPUT_RETENTION_HOURS, 1, 720),
    workflow: env.GENERATION_WORKFLOW,
  };
}

export function isMockGenerationAvailable(env: Env): boolean {
  try {
    resolveGenerationWorkflowConfiguration(env);
    return true;
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
