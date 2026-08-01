import {
  idempotencyKeySchema,
  jobIdSchema,
  jobStatusSchema,
  ownerIdSchema,
  presetIdSchema,
  presetVersionSchema,
  uploadIdSchema,
  type JobStatus,
  type PresetId,
} from "@studymix/contracts";
import { createSecureId, transitionJobState } from "@studymix/core";
import { z } from "zod";
import {
  RepositoryConflictError,
  RepositoryCreditsInsufficientError,
  RepositoryEntitlementRequiredError,
  RepositoryLegalAcceptanceRequiredError,
  RepositoryNotFoundError,
  RepositoryQuotaError,
  RepositoryStateError,
} from "./errors";
import { getOwnedCreditSummary } from "./credit-repository";
import { hasCurrentLegalAcceptances } from "./legal-acceptance-repository";

const providerSchema = z.enum(["mock", "fal", "self-hosted"]);

const jobRowSchema = z.object({
  candidate_count: z.literal(2),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  error_code: z.string().max(128).nullable(),
  expires_at: z.string().datetime({ offset: true }),
  id: jobIdSchema,
  idempotency_key: idempotencyKeySchema,
  owner_id: ownerIdSchema,
  preset_id: presetIdSchema,
  preset_version: presetVersionSchema,
  provider: providerSchema,
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  status: jobStatusSchema,
  updated_at: z.string().datetime({ offset: true }),
  upload_id: uploadIdSchema,
  workflow_instance_id: z.string().min(1).max(128).nullable(),
});

const createJobSchema = z.object({
  creditCost: z.number().int().min(1).max(1_000).default(1),
  createdAt: z.string().datetime({ offset: true }),
  dailyWindowStartedAt: z.string().datetime({ offset: true }).default("1970-01-01T00:00:00.000Z"),
  expiresAt: z.string().datetime({ offset: true }),
  id: jobIdSchema,
  idempotencyKey: idempotencyKeySchema,
  maxActiveJobs: z.number().int().min(1).max(20),
  maxDailyJobs: z.number().int().min(1).max(100).default(100),
  ownerId: ownerIdSchema,
  presetId: presetIdSchema,
  presetVersion: presetVersionSchema,
  provider: providerSchema,
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  uploadId: uploadIdSchema,
});

export type CreateJobInput = z.input<typeof createJobSchema>;

export type JobRecord = {
  candidateCount: 2;
  completedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  expiresAt: string;
  id: string;
  idempotencyKey: string;
  ownerId: string;
  presetId: PresetId;
  presetVersion: number;
  provider: z.infer<typeof providerSchema>;
  requestFingerprint: string;
  status: JobStatus;
  updatedAt: string;
  uploadId: string;
  workflowInstanceId: string | null;
};

export type IdempotentJobResult = {
  created: boolean;
  job: JobRecord;
};

function mapJobRow(value: unknown): JobRecord {
  const row = jobRowSchema.parse(value);
  return {
    candidateCount: row.candidate_count,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    errorCode: row.error_code,
    expiresAt: row.expires_at,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    ownerId: row.owner_id,
    presetId: row.preset_id,
    presetVersion: row.preset_version,
    provider: row.provider,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    updatedAt: row.updated_at,
    uploadId: row.upload_id,
    workflowInstanceId: row.workflow_instance_id,
  };
}

export async function getOwnedJob(
  db: D1Database,
  ownerId: string,
  jobId: string,
): Promise<JobRecord | null> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedJobId = jobIdSchema.parse(jobId);
  const row = await db
    .prepare("SELECT * FROM jobs WHERE id = ?1 AND owner_id = ?2")
    .bind(parsedJobId, parsedOwnerId)
    .first();

  return row === null ? null : mapJobRow(row);
}

async function getJobByIdempotencyKey(
  db: D1Database,
  ownerId: string,
  idempotencyKey: string,
): Promise<JobRecord | null> {
  const row = await db
    .prepare("SELECT * FROM jobs WHERE owner_id = ?1 AND idempotency_key = ?2")
    .bind(ownerId, idempotencyKey)
    .first();

  return row === null ? null : mapJobRow(row);
}

export async function createJobIdempotently(
  db: D1Database,
  input: CreateJobInput,
): Promise<IdempotentJobResult> {
  const parsed = createJobSchema.parse(input);
  if (!(await hasCurrentLegalAcceptances(db, parsed.ownerId))) {
    throw new RepositoryLegalAcceptanceRequiredError(
      "Current legal documents must be accepted before creating a job.",
    );
  }
  const reserveEventId = createSecureId("evt");
  const [jobInsertResult, reserveInsertResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO jobs (
        id, owner_id, upload_id, preset_id, preset_version, status,
        idempotency_key, request_fingerprint, workflow_instance_id,
        candidate_count, provider, error_code, created_at, updated_at,
        completed_at, expires_at
      )
      SELECT ?1, ?2, uploads.id, ?4, ?5, 'created', ?6, ?7, NULL,
             2, ?8, NULL, ?9, ?9, NULL, ?10
      FROM uploads
      WHERE uploads.id = ?3
        AND uploads.owner_id = ?2
        AND uploads.status = 'confirmed'
        AND uploads.expires_at > ?9
        AND (
          SELECT COUNT(*) FROM jobs
          WHERE jobs.owner_id = ?2
            AND jobs.status IN ('created', 'validating', 'queued', 'generating', 'processing_output')
        ) < ?11
        AND (
          SELECT COUNT(*) FROM jobs
          WHERE jobs.owner_id = ?2
            AND jobs.created_at >= ?12
        ) < ?13
        AND EXISTS (
          SELECT 1 FROM owner_entitlements
          WHERE owner_entitlements.owner_id = ?2
            AND owner_entitlements.status = 'active'
        )
        AND COALESCE((
          SELECT available_credits FROM credit_balances
          WHERE credit_balances.owner_id = ?2
        ), 0) >= ?14
      ON CONFLICT (owner_id, idempotency_key) DO NOTHING
      RETURNING *`,
      )
      .bind(
        parsed.id,
        parsed.ownerId,
        parsed.uploadId,
        parsed.presetId,
        parsed.presetVersion,
        parsed.idempotencyKey,
        parsed.requestFingerprint,
        parsed.provider,
        parsed.createdAt,
        parsed.expiresAt,
        parsed.maxActiveJobs,
        parsed.dailyWindowStartedAt,
        parsed.maxDailyJobs,
        parsed.creditCost,
      ),
    db
      .prepare(
        `INSERT INTO credit_ledger (
          id, owner_id, job_id, event_type, quantity, reference_key, created_at
        )
        SELECT ?1, jobs.owner_id, jobs.id, 'reserve', ?4, ?5, ?6
        FROM jobs
        WHERE jobs.id = ?2
          AND jobs.owner_id = ?3
        ON CONFLICT (owner_id, reference_key) DO NOTHING`,
      )
      .bind(
        reserveEventId,
        parsed.id,
        parsed.ownerId,
        parsed.creditCost,
        `job:${parsed.id}:reserve`,
        parsed.createdAt,
      ),
  ]);
  const inserted = jobInsertResult?.results[0] ?? null;

  if (inserted !== null) {
    if ((reserveInsertResult?.meta.changes ?? 0) !== 1) {
      throw new RepositoryStateError("The job credit reservation could not be recorded.");
    }
    return { created: true, job: mapJobRow(inserted) };
  }

  const existing = await getJobByIdempotencyKey(db, parsed.ownerId, parsed.idempotencyKey);
  if (existing !== null) {
    if (existing.requestFingerprint !== parsed.requestFingerprint) {
      throw new RepositoryConflictError(
        "Idempotency key was already used for a different request.",
      );
    }
    return { created: false, job: existing };
  }

  const confirmedUpload = await db
    .prepare(
      `SELECT id FROM uploads
       WHERE id = ?1
         AND owner_id = ?2
         AND status = 'confirmed'
         AND expires_at > ?3`,
    )
    .bind(parsed.uploadId, parsed.ownerId, parsed.createdAt)
    .first();
  if (confirmedUpload === null) {
    throw new RepositoryNotFoundError("Confirmed upload was not found for this owner.");
  }

  const active = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM jobs
       WHERE owner_id = ?1
         AND status IN ('created', 'validating', 'queued', 'generating', 'processing_output')`,
    )
    .bind(parsed.ownerId)
    .first<{ total: number }>();
  if ((active?.total ?? 0) >= parsed.maxActiveJobs) {
    throw new RepositoryQuotaError("The active job limit has been reached.");
  }
  const daily = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM jobs
       WHERE owner_id = ?1
         AND created_at >= ?2`,
    )
    .bind(parsed.ownerId, parsed.dailyWindowStartedAt)
    .first<{ total: number }>();
  if ((daily?.total ?? 0) >= parsed.maxDailyJobs) {
    throw new RepositoryQuotaError("The daily job limit has been reached.");
  }
  const creditSummary = await getOwnedCreditSummary(db, parsed.ownerId);
  if (creditSummary === null || creditSummary.status !== "active") {
    throw new RepositoryEntitlementRequiredError("An active beta entitlement is required.");
  }
  if (creditSummary.availableCredits < parsed.creditCost) {
    throw new RepositoryCreditsInsufficientError(
      "The private beta credit balance is insufficient.",
    );
  }
  throw new RepositoryStateError("Job creation could not be completed.");
}

export async function attachOwnedJobWorkflow(
  db: D1Database,
  ownerId: string,
  jobId: string,
  workflowInstanceId: string,
): Promise<JobRecord> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedJobId = jobIdSchema.parse(jobId);
  const parsedWorkflowInstanceId = z.string().trim().min(1).max(100).parse(workflowInstanceId);
  const row = await db
    .prepare(
      `UPDATE jobs
       SET workflow_instance_id = ?1
       WHERE id = ?2
         AND owner_id = ?3
         AND (workflow_instance_id IS NULL OR workflow_instance_id = ?1)
       RETURNING *`,
    )
    .bind(parsedWorkflowInstanceId, parsedJobId, parsedOwnerId)
    .first();
  if (row !== null) {
    return mapJobRow(row);
  }

  const existing = await getOwnedJob(db, parsedOwnerId, parsedJobId);
  if (existing === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  throw new RepositoryConflictError("Job is already attached to a different Workflow instance.");
}

export async function transitionOwnedJob(
  db: D1Database,
  ownerId: string,
  jobId: string,
  expectedCurrentStates: readonly JobStatus[],
  nextState: JobStatus,
  metadata: { completedAt: string | null; errorCode: string | null; updatedAt: string },
): Promise<JobRecord> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedJobId = jobIdSchema.parse(jobId);
  const parsedExpectedStates = z.array(jobStatusSchema).min(1).parse(expectedCurrentStates);
  const parsedNextState = jobStatusSchema.parse(nextState);
  const parsedMetadata = z
    .object({
      completedAt: z.string().datetime({ offset: true }).nullable(),
      errorCode: z.string().trim().min(1).max(128).nullable(),
      updatedAt: z.string().datetime({ offset: true }),
    })
    .parse(metadata);

  const current = await getOwnedJob(db, parsedOwnerId, parsedJobId);
  if (current === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  if (current.status === parsedNextState) {
    return current;
  }
  if (!parsedExpectedStates.includes(current.status)) {
    throw new RepositoryStateError("Job is not in an expected current state.");
  }

  try {
    transitionJobState(current.status, parsedNextState);
  } catch {
    throw new RepositoryStateError("Job transition is not allowed.");
  }

  const updated = await db
    .prepare(
      `UPDATE jobs
       SET status = ?1, updated_at = ?2, error_code = ?3, completed_at = ?4
       WHERE id = ?5 AND owner_id = ?6 AND status = ?7
       RETURNING *`,
    )
    .bind(
      parsedNextState,
      parsedMetadata.updatedAt,
      parsedMetadata.errorCode,
      parsedMetadata.completedAt,
      parsedJobId,
      parsedOwnerId,
      current.status,
    )
    .first();

  if (updated === null) {
    throw new RepositoryStateError("Job state changed concurrently.");
  }

  return mapJobRow(updated);
}

const finalizeJobCreditsSchema = z.object({
  eventId: z.string().regex(/^evt_[0-9a-f]{32}$/),
  jobId: jobIdSchema,
  ownerId: ownerIdSchema,
  timestamp: z.string().datetime({ offset: true }),
});

export async function completeOwnedJobWithCredits(
  db: D1Database,
  input: z.input<typeof finalizeJobCreditsSchema>,
): Promise<JobRecord> {
  const parsed = finalizeJobCreditsSchema.parse(input);
  const current = await getOwnedJob(db, parsed.ownerId, parsed.jobId);
  if (current === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  if (current.status === "completed") {
    return current;
  }
  try {
    transitionJobState(current.status, "completed");
  } catch {
    throw new RepositoryStateError("Job cannot complete from its current state.");
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (
          id, owner_id, job_id, event_type, quantity, reference_key, created_at
        )
        SELECT ?1, reserve.owner_id, reserve.job_id, 'settle', reserve.quantity, ?2, ?3
        FROM credit_ledger AS reserve
        WHERE reserve.owner_id = ?4
          AND reserve.job_id = ?5
          AND reserve.event_type = 'reserve'
          AND NOT EXISTS (
            SELECT 1 FROM credit_ledger AS final
            WHERE final.owner_id = reserve.owner_id
              AND final.job_id = reserve.job_id
              AND final.event_type IN ('settle', 'release')
          )
        ON CONFLICT (owner_id, reference_key) DO NOTHING`,
      )
      .bind(
        parsed.eventId,
        `job:${parsed.jobId}:settle`,
        parsed.timestamp,
        parsed.ownerId,
        parsed.jobId,
      ),
    db
      .prepare(
        `UPDATE jobs
         SET status = 'completed', updated_at = ?1, completed_at = ?1, error_code = NULL
         WHERE id = ?2
           AND owner_id = ?3
           AND status = ?4
           AND EXISTS (
             SELECT 1 FROM credit_ledger
             WHERE owner_id = ?3
               AND job_id = ?2
               AND event_type = 'settle'
           )`,
      )
      .bind(parsed.timestamp, parsed.jobId, parsed.ownerId, current.status),
  ]);

  const completed = await getOwnedJob(db, parsed.ownerId, parsed.jobId);
  if (completed === null || completed.status !== "completed") {
    throw new RepositoryStateError("Job completion and credit settlement did not commit.");
  }
  return completed;
}

export async function failOwnedJobWithCreditRelease(
  db: D1Database,
  input: z.input<typeof finalizeJobCreditsSchema> & { errorCode: string },
): Promise<JobRecord> {
  const parsed = finalizeJobCreditsSchema
    .extend({ errorCode: z.string().trim().min(1).max(128) })
    .parse(input);
  const current = await getOwnedJob(db, parsed.ownerId, parsed.jobId);
  if (current === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  if (current.status === "failed") {
    return current;
  }
  try {
    transitionJobState(current.status, "failed");
  } catch {
    throw new RepositoryStateError("Job cannot fail from its current state.");
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (
          id, owner_id, job_id, event_type, quantity, reference_key, created_at
        )
        SELECT ?1, reserve.owner_id, reserve.job_id, 'release', reserve.quantity, ?2, ?3
        FROM credit_ledger AS reserve
        WHERE reserve.owner_id = ?4
          AND reserve.job_id = ?5
          AND reserve.event_type = 'reserve'
          AND NOT EXISTS (
            SELECT 1 FROM credit_ledger AS final
            WHERE final.owner_id = reserve.owner_id
              AND final.job_id = reserve.job_id
              AND final.event_type IN ('settle', 'release')
          )
        ON CONFLICT (owner_id, reference_key) DO NOTHING`,
      )
      .bind(
        parsed.eventId,
        `job:${parsed.jobId}:release`,
        parsed.timestamp,
        parsed.ownerId,
        parsed.jobId,
      ),
    db
      .prepare(
        `UPDATE jobs
         SET status = 'failed', updated_at = ?1, completed_at = ?1, error_code = ?2
         WHERE id = ?3
           AND owner_id = ?4
           AND status = ?5
           AND EXISTS (
             SELECT 1 FROM credit_ledger
             WHERE owner_id = ?4
               AND job_id = ?3
               AND event_type = 'release'
           )`,
      )
      .bind(parsed.timestamp, parsed.errorCode, parsed.jobId, parsed.ownerId, current.status),
  ]);

  const failed = await getOwnedJob(db, parsed.ownerId, parsed.jobId);
  if (failed === null || failed.status !== "failed") {
    throw new RepositoryStateError("Job failure and credit release did not commit.");
  }
  return failed;
}
