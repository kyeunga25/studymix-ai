import { jobIdSchema, outputIdSchema, ownerIdSchema, uploadIdSchema } from "@studymix/contracts";
import { z } from "zod";
import { RepositoryNotFoundError, RepositoryStateError } from "./errors";
import { getOwnedJob } from "./job-repository";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const limitSchema = z.number().int().min(1).max(100);
const terminalJobStatusSchema = z.enum(["completed", "failed", "cancelled", "expired"]);

const purgeUploadRowSchema = z.object({
  id: uploadIdSchema,
  object_key: z.string().min(1).max(1024),
  owner_id: ownerIdSchema,
});

const purgeOutputRowSchema = z.object({
  id: outputIdSchema,
  object_key: z.string().min(1).max(1024),
});

const dueJobRowSchema = z.object({
  id: jobIdSchema,
  owner_id: ownerIdSchema,
});

export type PurgeUploadTarget = Readonly<{
  id: string;
  objectKey: string;
  ownerId: string;
}>;

export type PurgeOutputTarget = Readonly<{
  id: string;
  objectKey: string;
}>;

export type JobPurgeTarget = Readonly<{
  jobId: string;
  outputs: readonly PurgeOutputTarget[];
  ownerId: string;
  upload: PurgeUploadTarget | null;
}>;

function mapUploadTarget(value: unknown): PurgeUploadTarget {
  const row = purgeUploadRowSchema.parse(value);
  return { id: row.id, objectKey: row.object_key, ownerId: row.owner_id };
}

function mapOutputTarget(value: unknown): PurgeOutputTarget {
  const row = purgeOutputRowSchema.parse(value);
  return { id: row.id, objectKey: row.object_key };
}

export async function listDueTerminalJobPurges(
  db: D1Database,
  input: {
    failedArtifactCutoff: string;
    limit: number;
    now: string;
  },
): Promise<readonly { jobId: string; ownerId: string }[]> {
  const parsed = z
    .object({
      failedArtifactCutoff: isoDateTimeSchema,
      limit: limitSchema,
      now: isoDateTimeSchema,
    })
    .parse(input);
  const rows = await db
    .prepare(
      `SELECT jobs.id, jobs.owner_id
       FROM jobs
       WHERE (
         (jobs.status = 'completed' AND jobs.expires_at <= ?1)
         OR (
           jobs.status IN ('failed', 'cancelled')
           AND jobs.completed_at IS NOT NULL
           AND jobs.completed_at <= ?2
         )
         OR jobs.status = 'expired'
       )
       AND (
         jobs.status <> 'expired'
         OR
         EXISTS (
           SELECT 1 FROM uploads
           WHERE uploads.id = jobs.upload_id
             AND uploads.status <> 'deleted'
             AND NOT EXISTS (
               SELECT 1 FROM jobs AS retaining_jobs
               WHERE retaining_jobs.upload_id = uploads.id
                 AND retaining_jobs.id <> jobs.id
                 AND retaining_jobs.status <> 'expired'
             )
         )
         OR EXISTS (
           SELECT 1 FROM outputs
           WHERE outputs.job_id = jobs.id AND outputs.status <> 'deleted'
         )
       )
       ORDER BY jobs.updated_at, jobs.id
       LIMIT ?3`,
    )
    .bind(parsed.now, parsed.failedArtifactCutoff, parsed.limit)
    .all();
  return rows.results.map((value) => {
    const row = dueJobRowSchema.parse(value);
    return { jobId: row.id, ownerId: row.owner_id };
  });
}

export async function claimOwnedTerminalJobPurge(
  db: D1Database,
  ownerId: string,
  jobId: string,
  expiredAt: string,
): Promise<JobPurgeTarget> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedJobId = jobIdSchema.parse(jobId);
  const parsedExpiredAt = isoDateTimeSchema.parse(expiredAt);
  const job = await getOwnedJob(db, parsedOwnerId, parsedJobId);
  if (job === null) {
    throw new RepositoryNotFoundError("Job was not found for this owner.");
  }
  const terminalStatus = terminalJobStatusSchema.safeParse(job.status);
  if (!terminalStatus.success) {
    throw new RepositoryStateError("Only a terminal job can be deleted.");
  }

  const batchResults = await db.batch([
    db
      .prepare(
        `UPDATE jobs
         SET status = 'expired', updated_at = ?1
         WHERE id = ?2
           AND owner_id = ?3
           AND status IN ('completed', 'failed', 'cancelled', 'expired')
         RETURNING id`,
      )
      .bind(parsedExpiredAt, parsedJobId, parsedOwnerId),
    db
      .prepare(
        `UPDATE uploads
         SET status = 'expired'
         WHERE id = (SELECT upload_id FROM jobs WHERE id = ?1 AND owner_id = ?2)
           AND owner_id = ?2
           AND status IN ('pending', 'confirmed', 'expired')
           AND NOT EXISTS (
             SELECT 1 FROM jobs AS retaining_jobs
             WHERE retaining_jobs.upload_id = uploads.id
               AND retaining_jobs.id <> ?1
               AND retaining_jobs.status <> 'expired'
           )
         RETURNING id, owner_id, object_key`,
      )
      .bind(parsedJobId, parsedOwnerId),
    db
      .prepare(
        `UPDATE outputs
         SET status = 'expired'
         WHERE job_id = ?1
           AND status IN ('pending', 'ready', 'failed', 'expired')
           AND EXISTS (
             SELECT 1 FROM jobs WHERE jobs.id = outputs.job_id AND jobs.owner_id = ?2
           )
         RETURNING id, object_key`,
      )
      .bind(parsedJobId, parsedOwnerId),
  ]);

  if (batchResults[0]?.results[0] === undefined) {
    throw new RepositoryStateError("The terminal job could not be claimed for deletion.");
  }
  const uploadRow = batchResults[1]?.results[0];
  const outputRows = batchResults[2]?.results ?? [];

  return {
    jobId: parsedJobId,
    outputs: outputRows.map(mapOutputTarget),
    ownerId: parsedOwnerId,
    upload: uploadRow === undefined ? null : mapUploadTarget(uploadRow),
  };
}

export async function finishOwnedJobPurge(
  db: D1Database,
  ownerId: string,
  jobId: string,
  capabilityCutoff: string,
): Promise<void> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedJobId = jobIdSchema.parse(jobId);
  const parsedCapabilityCutoff = isoDateTimeSchema.parse(capabilityCutoff);
  await db.batch([
    db
      .prepare(
        `UPDATE uploads
         SET status = 'deleted'
         WHERE id = (SELECT upload_id FROM jobs WHERE id = ?1 AND owner_id = ?2)
           AND owner_id = ?2
           AND status = 'expired'
           AND created_at <= ?3
           AND NOT EXISTS (
             SELECT 1 FROM jobs AS retaining_jobs
             WHERE retaining_jobs.upload_id = uploads.id
               AND retaining_jobs.id <> ?1
               AND retaining_jobs.status <> 'expired'
           )`,
      )
      .bind(parsedJobId, parsedOwnerId, parsedCapabilityCutoff),
    db
      .prepare(
        `UPDATE outputs
         SET status = 'deleted'
         WHERE job_id = ?1
           AND status = 'expired'
           AND EXISTS (
             SELECT 1 FROM jobs WHERE jobs.id = outputs.job_id AND jobs.owner_id = ?2
           )`,
      )
      .bind(parsedJobId, parsedOwnerId),
  ]);
}

async function claimUploadPurges(
  db: D1Database,
  query: string,
  bindings: readonly (number | string)[],
): Promise<readonly PurgeUploadTarget[]> {
  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all();
  return result.results.map(mapUploadTarget);
}

export async function claimDueCompletedSourcePurges(
  db: D1Database,
  input: { cutoff: string; limit: number },
): Promise<readonly PurgeUploadTarget[]> {
  const parsed = z.object({ cutoff: isoDateTimeSchema, limit: limitSchema }).parse(input);
  return await claimUploadPurges(
    db,
    `UPDATE uploads
     SET status = 'expired'
     WHERE id IN (
       SELECT uploads.id
       FROM uploads
       INNER JOIN jobs ON jobs.upload_id = uploads.id
       WHERE jobs.status = 'completed'
         AND jobs.completed_at IS NOT NULL
         AND jobs.completed_at <= ?1
         AND uploads.status IN ('confirmed', 'expired')
         AND NOT EXISTS (
           SELECT 1 FROM jobs AS retaining_jobs
           WHERE retaining_jobs.upload_id = uploads.id
             AND retaining_jobs.id <> jobs.id
             AND (
               retaining_jobs.status NOT IN ('completed', 'expired')
               OR (
                 retaining_jobs.status = 'completed'
                 AND (
                   retaining_jobs.completed_at IS NULL
                   OR retaining_jobs.completed_at > ?1
                 )
               )
             )
         )
       ORDER BY jobs.completed_at, uploads.id
       LIMIT ?2
     )
     RETURNING id, owner_id, object_key`,
    [parsed.cutoff, parsed.limit],
  );
}

export async function claimDueUnattachedUploadPurges(
  db: D1Database,
  input: {
    capabilityCutoff: string;
    confirmedCutoff: string;
    limit: number;
    pendingCutoff: string;
  },
): Promise<readonly PurgeUploadTarget[]> {
  const parsed = z
    .object({
      capabilityCutoff: isoDateTimeSchema,
      confirmedCutoff: isoDateTimeSchema,
      limit: limitSchema,
      pendingCutoff: isoDateTimeSchema,
    })
    .parse(input);
  return await claimUploadPurges(
    db,
    `UPDATE uploads
     SET status = 'expired'
     WHERE id IN (
       SELECT uploads.id
       FROM uploads
       WHERE (
           (uploads.status = 'pending' AND uploads.created_at <= ?1)
           OR (
             uploads.status IN ('confirmed', 'expired')
             AND uploads.expires_at <= ?2
           )
         )
         AND uploads.created_at <= ?3
         AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.upload_id = uploads.id)
       ORDER BY uploads.created_at, uploads.id
       LIMIT ?4
     )
     RETURNING id, owner_id, object_key`,
    [parsed.pendingCutoff, parsed.confirmedCutoff, parsed.capabilityCutoff, parsed.limit],
  );
}

export async function finishClaimedUploadPurges(
  db: D1Database,
  targets: readonly PurgeUploadTarget[],
  capabilityCutoff: string,
): Promise<void> {
  if (targets.length === 0) {
    return;
  }
  const parsedCapabilityCutoff = isoDateTimeSchema.parse(capabilityCutoff);
  await db.batch(
    targets.map((target) =>
      db
        .prepare(
          `UPDATE uploads
           SET status = 'deleted'
           WHERE id = ?1
             AND owner_id = ?2
             AND status = 'expired'
             AND created_at <= ?3`,
        )
        .bind(target.id, target.ownerId, parsedCapabilityCutoff),
    ),
  );
}
