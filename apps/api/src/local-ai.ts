import {
  createLocalSyntheticUploadRequestSchema,
  idempotencyKeySchema,
  isoDateTimeSchema,
  jobIdSchema,
  localAiFixtureSchema,
  localAiScenarioSchema,
  ownerIdSchema,
  uploadIdSchema,
  type LocalAiScenario,
} from "@studymix/contracts";
import { createSecureId } from "@studymix/core";
import {
  audioOrchestrationPolicySchema,
  createDeterministicSyntheticWave,
  type AudioOrchestrationPolicy,
} from "@studymix/providers";
import { z } from "zod";
import { isLocalRuntimeEnvironment, isLocalRuntimeRequest } from "./local-runtime";
import {
  createUpload,
  confirmOwnedUpload,
  getOwnedUpload,
  markOwnedUploadDeleted,
} from "./repositories";
import type { UploadRecord } from "./repositories/upload-repository";
import { resolveAbandonedUploadRetentionHours } from "./retention";
import { resolveR2TransferConfiguration } from "./r2-transfer";

const LOCAL_SOURCE_DURATION_SECONDS = 2;
const LOCAL_MAX_INPUT_DURATION_SECONDS = 30;
const LOCAL_MAX_OUTPUT_DURATION_SECONDS = 5;
const LOCAL_MAX_OUTPUT_BYTES = 65_536;
const LOCAL_MAX_ATTEMPTS_PER_CANDIDATE = 3;
const LOCAL_MAX_CONCURRENT_CANDIDATES = 1;
const LOCAL_MAX_COST_UNITS = 4;

const localAiSourceRowSchema = z.object({
  content_type: z.literal("audio/wav"),
  created_at: isoDateTimeSchema,
  duration_seconds: z.number().positive().finite(),
  fixture_id: localAiFixtureSchema,
  owner_id: ownerIdSchema,
  request_key: idempotencyKeySchema,
  scenario: localAiScenarioSchema,
  size_bytes: z.number().int().positive().safe(),
  upload_id: uploadIdSchema,
});

const localAiJobPolicyRowSchema = z.object({
  candidate_count: z.literal(2),
  created_at: isoDateTimeSchema,
  job_id: jobIdSchema,
  max_attempts_per_candidate: z.number().int().positive().max(8),
  max_concurrent_candidates: z.number().int().positive().max(2),
  max_cost_units: z.number().int().positive().max(100),
  max_input_duration_seconds: z.number().positive().finite(),
  max_output_bytes: z.number().int().positive().safe(),
  max_output_duration_seconds: z.number().positive().finite(),
  owner_id: ownerIdSchema,
  quality_tier: z.literal("synthetic-preview"),
  retention_seconds: z.number().int().positive().safe(),
  scenario: localAiScenarioSchema,
  source_content_type: z.literal("audio/wav"),
  source_duration_seconds: z.number().positive().finite(),
  source_size_bytes: z.number().int().positive().safe(),
  source_upload_id: uploadIdSchema,
});

const localAiAttemptRowSchema = z.object({
  actual_cost_units: z.number().int().nonnegative().safe().nullable(),
  attempt_number: z.number().int().positive().safe(),
  candidate_index: z.union([z.literal(0), z.literal(1)]),
  created_at: isoDateTimeSchema,
  estimated_cost_units: z.number().int().nonnegative().safe(),
  id: z.string().regex(/^att_[0-9a-f]{32}$/),
  job_id: jobIdSchema,
  last_poll_attempt: z.number().int().nonnegative().safe(),
  owner_id: ownerIdSchema,
  status: z.enum(["submitted", "polling", "completed", "failed", "cancelled"]),
  updated_at: isoDateTimeSchema,
});

export type LocalAiSource = Readonly<{
  contentType: "audio/wav";
  createdAt: string;
  durationSeconds: number;
  fixture: "deterministic-tone-v1";
  ownerId: string;
  requestKey: string;
  scenario: LocalAiScenario;
  sizeBytes: number;
  uploadId: string;
}>;

export type LocalAiJobPolicy = Readonly<{
  createdAt: string;
  jobId: string;
  ownerId: string;
  policy: AudioOrchestrationPolicy;
  scenario: LocalAiScenario;
  source: Readonly<{
    contentType: "audio/wav";
    durationSeconds: number;
    sizeBytes: number;
    uploadId: string;
  }>;
}>;

export type LocalAiAttempt = Readonly<{
  actualCostUnits: number | null;
  attemptId: string;
  attemptNumber: number;
  candidateIndex: 0 | 1;
  estimatedCostUnits: number;
  jobId: string;
  lastPollAttempt: number;
  ownerId: string;
  status: "submitted" | "polling" | "completed" | "failed" | "cancelled";
}>;

function mapLocalAiSource(value: unknown): LocalAiSource {
  const row = localAiSourceRowSchema.parse(value);
  return {
    contentType: row.content_type,
    createdAt: row.created_at,
    durationSeconds: row.duration_seconds,
    fixture: row.fixture_id,
    ownerId: row.owner_id,
    requestKey: row.request_key,
    scenario: row.scenario,
    sizeBytes: row.size_bytes,
    uploadId: row.upload_id,
  };
}

function mapLocalAiJobPolicy(value: unknown): LocalAiJobPolicy {
  const row = localAiJobPolicyRowSchema.parse(value);
  const policy = audioOrchestrationPolicySchema.parse({
    candidateCount: row.candidate_count,
    maxAttemptsPerCandidate: row.max_attempts_per_candidate,
    maxConcurrentCandidates: row.max_concurrent_candidates,
    maxCostUnits: row.max_cost_units,
    maxInputDurationSeconds: row.max_input_duration_seconds,
    maxOutputBytes: row.max_output_bytes,
    maxOutputDurationSeconds: row.max_output_duration_seconds,
    qualityTier: row.quality_tier,
    retentionSeconds: row.retention_seconds,
  });
  return {
    createdAt: row.created_at,
    jobId: row.job_id,
    ownerId: row.owner_id,
    policy,
    scenario: row.scenario,
    source: {
      contentType: row.source_content_type,
      durationSeconds: row.source_duration_seconds,
      sizeBytes: row.source_size_bytes,
      uploadId: row.source_upload_id,
    },
  };
}

function mapLocalAiAttempt(value: unknown): LocalAiAttempt {
  const row = localAiAttemptRowSchema.parse(value);
  return {
    actualCostUnits: row.actual_cost_units,
    attemptId: row.id,
    attemptNumber: row.attempt_number,
    candidateIndex: row.candidate_index,
    estimatedCostUnits: row.estimated_cost_units,
    jobId: row.job_id,
    lastPollAttempt: row.last_poll_attempt,
    ownerId: row.owner_id,
    status: row.status,
  };
}

export function isLocalAiHarnessRequest(request: Request, env: Env): boolean {
  return (
    isLocalRuntimeRequest(request, env) &&
    env.GENERATION_PROVIDER === "mock" &&
    env.REAL_GENERATION_ENABLED === "false" &&
    env.R2_TRANSFER_ENABLED === "true" &&
    env.JOB_WORKFLOW_ENABLED === "true" &&
    env.CREDIT_ACCOUNTING_ENABLED === "true" &&
    env.GENERATION_WORKFLOW !== undefined
  );
}

export function isLocalAiHarnessEnvironment(env: Env): boolean {
  return (
    (isLocalRuntimeEnvironment(env) || env.APP_ENV === "test") &&
    env.GENERATION_PROVIDER === "mock" &&
    env.REAL_GENERATION_ENABLED === "false"
  );
}

export async function getLocalAiSource(
  db: D1Database,
  ownerId: string,
  uploadId: string,
): Promise<LocalAiSource | null> {
  const row = await db
    .prepare(
      `SELECT local_ai_sources.*
       FROM local_ai_sources
       INNER JOIN uploads ON uploads.id = local_ai_sources.upload_id
       WHERE local_ai_sources.owner_id = ?1
         AND local_ai_sources.upload_id = ?2
         AND uploads.owner_id = ?1
         AND uploads.status = 'confirmed'`,
    )
    .bind(ownerIdSchema.parse(ownerId), uploadIdSchema.parse(uploadId))
    .first();
  return row === null ? null : mapLocalAiSource(row);
}

async function getLocalAiSourceByRequestKey(
  db: D1Database,
  ownerId: string,
  requestKey: string,
): Promise<LocalAiSource | null> {
  const row = await db
    .prepare(
      `SELECT local_ai_sources.*
       FROM local_ai_sources
       INNER JOIN uploads ON uploads.id = local_ai_sources.upload_id
       WHERE local_ai_sources.owner_id = ?1
         AND local_ai_sources.request_key = ?2
         AND uploads.owner_id = ?1
         AND uploads.status = 'confirmed'`,
    )
    .bind(ownerIdSchema.parse(ownerId), idempotencyKeySchema.parse(requestKey))
    .first();
  return row === null ? null : mapLocalAiSource(row);
}

export async function createLocalSyntheticSource(
  env: Env,
  ownerId: string,
  request: unknown,
  now: Date,
): Promise<UploadRecord> {
  if (!isLocalAiHarnessEnvironment(env)) {
    throw new TypeError("The local AI harness is unavailable.");
  }
  const parsed = createLocalSyntheticUploadRequestSchema.parse(request);
  const existingSource = await getLocalAiSourceByRequestKey(env.DB, ownerId, parsed.idempotencyKey);
  if (existingSource !== null) {
    const existingUpload = await getOwnedUpload(env.DB, ownerId, existingSource.uploadId);
    if (existingUpload !== null && existingUpload.status === "confirmed") {
      return existingUpload;
    }
  }

  const configuration = resolveR2TransferConfiguration(env);
  const audio = createDeterministicSyntheticWave(0, LOCAL_SOURCE_DURATION_SECONDS);
  if (audio.body.byteLength > configuration.maxUploadBytes) {
    throw new TypeError("The local synthetic fixture exceeds the upload limit.");
  }
  const uploadId = createSecureId("upl");
  const objectKey = `owners/${ownerIdSchema.parse(ownerId)}/uploads/${uploadId}/source`;
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + resolveAbandonedUploadRetentionHours(env) * 60 * 60 * 1_000,
  ).toISOString();
  const upload = await createUpload(env.DB, {
    createdAt,
    declaredContentType: audio.contentType,
    expiresAt,
    id: uploadId,
    maxActiveUploads: configuration.maxActiveUploads,
    objectKey,
    originalFilename: "studymix-synthetic-tone.wav",
    ownerId,
    sizeBytes: audio.body.byteLength,
  });

  try {
    const created = await env.AUDIO_BUCKET.put(objectKey, audio.body, {
      customMetadata: {
        durationSeconds: LOCAL_SOURCE_DURATION_SECONDS.toString(),
        localFixture: parsed.fixture,
        validationVersion: "local-v1",
      },
      httpMetadata: { contentType: audio.contentType },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    const object = created ?? (await env.AUDIO_BUCKET.head(objectKey));
    if (
      object === null ||
      object.size !== audio.body.byteLength ||
      object.httpMetadata?.contentType !== audio.contentType ||
      object.customMetadata?.localFixture !== parsed.fixture ||
      object.customMetadata?.durationSeconds !== LOCAL_SOURCE_DURATION_SECONDS.toString()
    ) {
      throw new TypeError("The local synthetic fixture could not be verified.");
    }
    const confirmed = await confirmOwnedUpload(
      env.DB,
      ownerId,
      upload.id,
      object.size,
      createdAt,
      expiresAt,
    );
    await env.DB.prepare(
      `INSERT INTO local_ai_sources (
        upload_id, owner_id, request_key, fixture_id, scenario,
        duration_seconds, content_type, size_bytes, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        confirmed.id,
        ownerId,
        parsed.idempotencyKey,
        parsed.fixture,
        parsed.scenario,
        LOCAL_SOURCE_DURATION_SECONDS,
        audio.contentType,
        audio.body.byteLength,
        createdAt,
      )
      .run();
    return confirmed;
  } catch (error) {
    await markOwnedUploadDeleted(env.DB, ownerId, upload.id);
    await env.AUDIO_BUCKET.delete(objectKey);
    throw error;
  }
}

export async function buildLocalAiJobPolicy(
  db: D1Database,
  ownerId: string,
  uploadId: string,
  outputRetentionHours: number,
): Promise<{
  candidateCount: 2;
  maxAttemptsPerCandidate: number;
  maxConcurrentCandidates: number;
  maxCostUnits: number;
  maxInputDurationSeconds: number;
  maxOutputBytes: number;
  maxOutputDurationSeconds: number;
  qualityTier: "synthetic-preview";
  retentionSeconds: number;
  scenario: LocalAiScenario;
  sourceContentType: "audio/wav";
  sourceDurationSeconds: number;
  sourceSizeBytes: number;
  sourceUploadId: string;
}> {
  const source = await getLocalAiSource(db, ownerId, uploadId);
  if (source === null) {
    throw new TypeError("A validated local synthetic source is required.");
  }
  const policy = audioOrchestrationPolicySchema.parse({
    candidateCount: 2,
    maxAttemptsPerCandidate: LOCAL_MAX_ATTEMPTS_PER_CANDIDATE,
    maxConcurrentCandidates: LOCAL_MAX_CONCURRENT_CANDIDATES,
    maxCostUnits: LOCAL_MAX_COST_UNITS,
    maxInputDurationSeconds: LOCAL_MAX_INPUT_DURATION_SECONDS,
    maxOutputBytes: LOCAL_MAX_OUTPUT_BYTES,
    maxOutputDurationSeconds: LOCAL_MAX_OUTPUT_DURATION_SECONDS,
    qualityTier: "synthetic-preview",
    retentionSeconds: outputRetentionHours * 60 * 60,
  });
  if (source.durationSeconds > policy.maxInputDurationSeconds) {
    throw new TypeError("The local synthetic source exceeds the duration limit.");
  }
  return {
    candidateCount: policy.candidateCount,
    maxAttemptsPerCandidate: policy.maxAttemptsPerCandidate,
    maxConcurrentCandidates: policy.maxConcurrentCandidates,
    maxCostUnits: policy.maxCostUnits,
    maxInputDurationSeconds: policy.maxInputDurationSeconds,
    maxOutputBytes: policy.maxOutputBytes,
    maxOutputDurationSeconds: policy.maxOutputDurationSeconds,
    qualityTier: policy.qualityTier,
    retentionSeconds: policy.retentionSeconds,
    scenario: source.scenario,
    sourceContentType: source.contentType,
    sourceDurationSeconds: source.durationSeconds,
    sourceSizeBytes: source.sizeBytes,
    sourceUploadId: source.uploadId,
  };
}

export async function getLocalAiJobPolicy(
  db: D1Database,
  ownerId: string,
  jobId: string,
): Promise<LocalAiJobPolicy | null> {
  const row = await db
    .prepare(
      `SELECT * FROM local_ai_job_policies
       WHERE owner_id = ?1 AND job_id = ?2`,
    )
    .bind(ownerIdSchema.parse(ownerId), jobIdSchema.parse(jobId))
    .first();
  return row === null ? null : mapLocalAiJobPolicy(row);
}

export async function recordLocalAiAttemptSubmitted(
  db: D1Database,
  input: {
    attemptId: string;
    candidateIndex: 0 | 1;
    createdAt: string;
    estimatedCostUnits: number;
    jobId: string;
    ownerId: string;
  },
): Promise<LocalAiAttempt> {
  const parsed = z
    .object({
      attemptId: z.string().regex(/^att_[0-9a-f]{32}$/),
      candidateIndex: z.union([z.literal(0), z.literal(1)]),
      createdAt: isoDateTimeSchema,
      estimatedCostUnits: z.number().int().nonnegative().max(100),
      jobId: jobIdSchema,
      ownerId: ownerIdSchema,
    })
    .parse(input);
  const row = await db
    .prepare(
      `INSERT INTO local_ai_attempts (
        id, owner_id, job_id, candidate_index, attempt_number, status,
        estimated_cost_units, actual_cost_units, last_poll_attempt, created_at, updated_at
      )
      SELECT ?1, ?2, ?3, ?4, 1, 'submitted', ?5, NULL, 0, ?6, ?6
      FROM local_ai_job_policies
      WHERE owner_id = ?2 AND job_id = ?3
      ON CONFLICT (owner_id, job_id, candidate_index, attempt_number) DO NOTHING
      RETURNING *`,
    )
    .bind(
      parsed.attemptId,
      parsed.ownerId,
      parsed.jobId,
      parsed.candidateIndex,
      parsed.estimatedCostUnits,
      parsed.createdAt,
    )
    .first();
  if (row !== null) {
    return mapLocalAiAttempt(row);
  }
  const existing = await db
    .prepare(
      `SELECT * FROM local_ai_attempts
       WHERE owner_id = ?1 AND job_id = ?2 AND candidate_index = ?3 AND attempt_number = 1`,
    )
    .bind(parsed.ownerId, parsed.jobId, parsed.candidateIndex)
    .first();
  if (existing === null) {
    throw new TypeError("The local orchestration attempt could not be recorded.");
  }
  const mapped = mapLocalAiAttempt(existing);
  if (
    mapped.attemptId !== parsed.attemptId ||
    mapped.estimatedCostUnits !== parsed.estimatedCostUnits
  ) {
    throw new TypeError("The local orchestration attempt conflicts with an existing attempt.");
  }
  return mapped;
}

export async function updateLocalAiAttempt(
  db: D1Database,
  input: {
    actualCostUnits: number | null;
    attemptId: string;
    lastPollAttempt: number;
    ownerId: string;
    status: LocalAiAttempt["status"];
    updatedAt: string;
  },
): Promise<LocalAiAttempt> {
  const parsed = z
    .object({
      actualCostUnits: z.number().int().nonnegative().max(100).nullable(),
      attemptId: z.string().regex(/^att_[0-9a-f]{32}$/),
      lastPollAttempt: z.number().int().nonnegative().max(100),
      ownerId: ownerIdSchema,
      status: localAiAttemptRowSchema.shape.status,
      updatedAt: isoDateTimeSchema,
    })
    .parse(input);
  const row = await db
    .prepare(
      `UPDATE local_ai_attempts
       SET status = ?1,
           actual_cost_units = COALESCE(actual_cost_units, ?2),
           last_poll_attempt = MAX(last_poll_attempt, ?3),
           updated_at = ?4
       WHERE id = ?5 AND owner_id = ?6
         AND status IN ('submitted', 'polling')
       RETURNING *`,
    )
    .bind(
      parsed.status,
      parsed.actualCostUnits,
      parsed.lastPollAttempt,
      parsed.updatedAt,
      parsed.attemptId,
      parsed.ownerId,
    )
    .first();
  if (row === null) {
    const existing = await db
      .prepare(
        `SELECT * FROM local_ai_attempts
         WHERE id = ?1 AND owner_id = ?2`,
      )
      .bind(parsed.attemptId, parsed.ownerId)
      .first();
    if (existing === null) {
      throw new TypeError("The local orchestration attempt was not found.");
    }
    return mapLocalAiAttempt(existing);
  }
  return mapLocalAiAttempt(row);
}

export async function cancelLocalAiAttempts(
  db: D1Database,
  ownerId: string,
  jobId: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE local_ai_attempts
       SET status = 'cancelled',
           actual_cost_units = COALESCE(actual_cost_units, estimated_cost_units),
           updated_at = ?1
       WHERE owner_id = ?2
         AND job_id = ?3
         AND status IN ('submitted', 'polling')`,
    )
    .bind(
      isoDateTimeSchema.parse(updatedAt),
      ownerIdSchema.parse(ownerId),
      jobIdSchema.parse(jobId),
    )
    .run();
}

export async function failLocalAiAttempts(
  db: D1Database,
  ownerId: string,
  jobId: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE local_ai_attempts
       SET status = 'failed',
           actual_cost_units = COALESCE(actual_cost_units, estimated_cost_units),
           updated_at = ?1
       WHERE owner_id = ?2
         AND job_id = ?3
         AND status IN ('submitted', 'polling')`,
    )
    .bind(
      isoDateTimeSchema.parse(updatedAt),
      ownerIdSchema.parse(ownerId),
      jobIdSchema.parse(jobId),
    )
    .run();
}
