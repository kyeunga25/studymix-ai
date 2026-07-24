import {
  candidateIndexSchema,
  jobIdSchema,
  outputIdSchema,
  outputStatusSchema,
  ownerIdSchema,
  rightsDeclarationIdSchema,
  uploadIdSchema,
} from "@studymix/contracts";
import { z } from "zod";
import { RepositoryNotFoundError } from "./errors";

const providerSchema = z.enum(["mock", "fal", "self-hosted"]);
const providerRequestIdSchema = z.string().regex(/^req_[0-9a-f]{32}$/);
const usageEventIdSchema = z.string().regex(/^evt_[0-9a-f]{32}$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });

const providerRequestRowSchema = z.object({
  candidate_index: candidateIndexSchema,
  completed_at: isoDateTimeSchema.nullable(),
  cost_estimate_usd: z.number().nonnegative().finite().nullable(),
  error_code: z.string().max(128).nullable(),
  id: providerRequestIdSchema,
  job_id: jobIdSchema,
  provider: providerSchema,
  provider_request_id: z.string().min(1).max(256).nullable(),
  seed: z.number().int().safe().nullable(),
  status: z.enum(["pending", "submitted", "completed", "failed"]),
  submitted_at: isoDateTimeSchema.nullable(),
});

const outputRowSchema = z.object({
  candidate_index: candidateIndexSchema,
  content_type: z.string().min(1).max(255).nullable(),
  created_at: isoDateTimeSchema,
  duration_seconds: z.number().nonnegative().finite().nullable(),
  expires_at: isoDateTimeSchema.nullable(),
  id: outputIdSchema,
  job_id: jobIdSchema,
  object_key: z.string().min(1).max(1024),
  size_bytes: z.number().int().nonnegative().safe().nullable(),
  status: outputStatusSchema,
});

const rightsRowSchema = z.object({
  accepted_at: isoDateTimeSchema,
  declaration_version: z.string().min(1).max(64),
  id: rightsDeclarationIdSchema,
  job_id: jobIdSchema,
  owner_id: ownerIdSchema,
  upload_id: uploadIdSchema,
});

const usageEventRowSchema = z.object({
  created_at: isoDateTimeSchema,
  estimated_cost_usd: z.number().nonnegative().finite().nullable(),
  event_type: z.string().min(1).max(128),
  id: usageEventIdSchema,
  job_id: jobIdSchema.nullable(),
  owner_id: ownerIdSchema,
  quantity: z.number().int().nonnegative().safe(),
});

export type ProviderRequestRecord = {
  candidateIndex: 0 | 1;
  completedAt: string | null;
  costEstimateUsd: number | null;
  errorCode: string | null;
  id: string;
  jobId: string;
  provider: z.infer<typeof providerSchema>;
  providerRequestId: string | null;
  seed: number | null;
  status: "pending" | "submitted" | "completed" | "failed";
  submittedAt: string | null;
};

export type OutputRecord = {
  candidateIndex: 0 | 1;
  contentType: string | null;
  createdAt: string;
  durationSeconds: number | null;
  expiresAt: string | null;
  id: string;
  jobId: string;
  objectKey: string;
  sizeBytes: number | null;
  status: z.infer<typeof outputStatusSchema>;
};

export type RightsDeclarationRecord = {
  acceptedAt: string;
  declarationVersion: string;
  id: string;
  jobId: string;
  ownerId: string;
  uploadId: string;
};

export type UsageEventRecord = {
  createdAt: string;
  estimatedCostUsd: number | null;
  eventType: string;
  id: string;
  jobId: string | null;
  ownerId: string;
  quantity: number;
};

function mapProviderRequestRow(value: unknown): ProviderRequestRecord {
  const row = providerRequestRowSchema.parse(value);
  return {
    candidateIndex: row.candidate_index,
    completedAt: row.completed_at,
    costEstimateUsd: row.cost_estimate_usd,
    errorCode: row.error_code,
    id: row.id,
    jobId: row.job_id,
    provider: row.provider,
    providerRequestId: row.provider_request_id,
    seed: row.seed,
    status: row.status,
    submittedAt: row.submitted_at,
  };
}

function mapOutputRow(value: unknown): OutputRecord {
  const row = outputRowSchema.parse(value);
  return {
    candidateIndex: row.candidate_index,
    contentType: row.content_type,
    createdAt: row.created_at,
    durationSeconds: row.duration_seconds,
    expiresAt: row.expires_at,
    id: row.id,
    jobId: row.job_id,
    objectKey: row.object_key,
    sizeBytes: row.size_bytes,
    status: row.status,
  };
}

function mapRightsRow(value: unknown): RightsDeclarationRecord {
  const row = rightsRowSchema.parse(value);
  return {
    acceptedAt: row.accepted_at,
    declarationVersion: row.declaration_version,
    id: row.id,
    jobId: row.job_id,
    ownerId: row.owner_id,
    uploadId: row.upload_id,
  };
}

function mapUsageEventRow(value: unknown): UsageEventRecord {
  const row = usageEventRowSchema.parse(value);
  return {
    createdAt: row.created_at,
    estimatedCostUsd: row.estimated_cost_usd,
    eventType: row.event_type,
    id: row.id,
    jobId: row.job_id,
    ownerId: row.owner_id,
    quantity: row.quantity,
  };
}

export async function createProviderRequest(
  db: D1Database,
  input: {
    candidateIndex: 0 | 1;
    id: string;
    jobId: string;
    ownerId: string;
    provider: z.infer<typeof providerSchema>;
  },
): Promise<ProviderRequestRecord> {
  const parsed = z
    .object({
      candidateIndex: candidateIndexSchema,
      id: providerRequestIdSchema,
      jobId: jobIdSchema,
      ownerId: ownerIdSchema,
      provider: providerSchema,
    })
    .parse(input);
  const row = await db
    .prepare(
      `INSERT INTO provider_requests (
        id, job_id, candidate_index, provider, provider_request_id, status,
        seed, submitted_at, completed_at, cost_estimate_usd, error_code
      )
      SELECT ?1, jobs.id, ?4, ?5, NULL, 'pending', NULL, NULL, NULL, NULL, NULL
      FROM jobs
      WHERE jobs.id = ?2 AND jobs.owner_id = ?3
      RETURNING *`,
    )
    .bind(parsed.id, parsed.jobId, parsed.ownerId, parsed.candidateIndex, parsed.provider)
    .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  return mapProviderRequestRow(row);
}

export async function createOutput(
  db: D1Database,
  input: {
    candidateIndex: 0 | 1;
    createdAt: string;
    expiresAt: string | null;
    id: string;
    jobId: string;
    objectKey: string;
    ownerId: string;
  },
): Promise<OutputRecord> {
  const parsed = z
    .object({
      candidateIndex: candidateIndexSchema,
      createdAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema.nullable(),
      id: outputIdSchema,
      jobId: jobIdSchema,
      objectKey: z.string().trim().min(1).max(1024),
      ownerId: ownerIdSchema,
    })
    .parse(input);
  const row = await db
    .prepare(
      `INSERT INTO outputs (
        id, job_id, candidate_index, object_key, content_type, size_bytes,
        duration_seconds, status, created_at, expires_at
      )
      SELECT ?1, jobs.id, ?4, ?5, NULL, NULL, NULL, 'pending', ?6, ?7
      FROM jobs
      WHERE jobs.id = ?2 AND jobs.owner_id = ?3
      RETURNING *`,
    )
    .bind(
      parsed.id,
      parsed.jobId,
      parsed.ownerId,
      parsed.candidateIndex,
      parsed.objectKey,
      parsed.createdAt,
      parsed.expiresAt,
    )
    .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  return mapOutputRow(row);
}

export async function getOwnedOutput(
  db: D1Database,
  ownerId: string,
  outputId: string,
): Promise<OutputRecord | null> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedOutputId = outputIdSchema.parse(outputId);
  const row = await db
    .prepare(
      `SELECT outputs.*
       FROM outputs
       INNER JOIN jobs ON jobs.id = outputs.job_id
       WHERE outputs.id = ?1 AND jobs.owner_id = ?2`,
    )
    .bind(parsedOutputId, parsedOwnerId)
    .first();
  return row === null ? null : mapOutputRow(row);
}

export async function recordRightsDeclaration(
  db: D1Database,
  input: {
    acceptedAt: string;
    declarationVersion: string;
    id: string;
    jobId: string;
    ownerId: string;
    uploadId: string;
  },
): Promise<RightsDeclarationRecord> {
  const parsed = z
    .object({
      acceptedAt: isoDateTimeSchema,
      declarationVersion: z.string().trim().min(1).max(64),
      id: rightsDeclarationIdSchema,
      jobId: jobIdSchema,
      ownerId: ownerIdSchema,
      uploadId: uploadIdSchema,
    })
    .parse(input);
  const row = await db
    .prepare(
      `INSERT INTO rights_declarations (
        id, job_id, upload_id, owner_id, declaration_version, accepted_at
      )
      SELECT ?1, jobs.id, uploads.id, ?3, ?5, ?6
      FROM jobs
      INNER JOIN uploads ON uploads.id = jobs.upload_id
      WHERE jobs.id = ?2
        AND jobs.owner_id = ?3
        AND uploads.id = ?4
        AND uploads.owner_id = ?3
      RETURNING *`,
    )
    .bind(
      parsed.id,
      parsed.jobId,
      parsed.ownerId,
      parsed.uploadId,
      parsed.declarationVersion,
      parsed.acceptedAt,
    )
    .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Job and upload were not found for this owner.");
  }
  return mapRightsRow(row);
}

export async function recordUsageEvent(
  db: D1Database,
  input: {
    createdAt: string;
    estimatedCostUsd: number | null;
    eventType: string;
    id: string;
    jobId: string | null;
    ownerId: string;
    quantity: number;
  },
): Promise<UsageEventRecord> {
  const parsed = z
    .object({
      createdAt: isoDateTimeSchema,
      estimatedCostUsd: z.number().nonnegative().finite().nullable(),
      eventType: z.string().trim().min(1).max(128),
      id: usageEventIdSchema,
      jobId: jobIdSchema.nullable(),
      ownerId: ownerIdSchema,
      quantity: z.number().int().nonnegative().safe(),
    })
    .parse(input);

  const row =
    parsed.jobId === null
      ? await db
          .prepare(
            `INSERT INTO usage_events (
              id, owner_id, job_id, event_type, quantity, estimated_cost_usd, created_at
            )
            SELECT ?1, owners.id, NULL, ?3, ?4, ?5, ?6
            FROM owners
            WHERE owners.id = ?2
            RETURNING *`,
          )
          .bind(
            parsed.id,
            parsed.ownerId,
            parsed.eventType,
            parsed.quantity,
            parsed.estimatedCostUsd,
            parsed.createdAt,
          )
          .first()
      : await db
          .prepare(
            `INSERT INTO usage_events (
              id, owner_id, job_id, event_type, quantity, estimated_cost_usd, created_at
            )
            SELECT ?1, jobs.owner_id, jobs.id, ?4, ?5, ?6, ?7
            FROM jobs
            WHERE jobs.id = ?3 AND jobs.owner_id = ?2
            RETURNING *`,
          )
          .bind(
            parsed.id,
            parsed.ownerId,
            parsed.jobId,
            parsed.eventType,
            parsed.quantity,
            parsed.estimatedCostUsd,
            parsed.createdAt,
          )
          .first();

  if (row === null) {
    throw new RepositoryNotFoundError("Owner or owned job was not found.");
  }
  return mapUsageEventRow(row);
}
