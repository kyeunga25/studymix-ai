import {
  RepositoryNotFoundError,
  RepositoryStateError,
  claimOwnedUploadDeletion,
  claimDueCompletedSourcePurges,
  claimDueUnattachedUploadPurges,
  claimOwnedTerminalJobPurge,
  finishOwnedUploadDeletion,
  finishClaimedUploadPurges,
  finishOwnedJobPurge,
  listDueTerminalJobPurges,
  type JobPurgeTarget,
  type PurgeUploadTarget,
} from "./repositories";
import { maximumSignedR2UrlTtlSeconds } from "./r2-transfer";

export class RetentionCleanupDisabledError extends Error {
  constructor() {
    super("Retention cleanup is disabled.");
    this.name = "RetentionCleanupDisabledError";
  }
}

export class RetentionCleanupConfigurationError extends Error {
  constructor() {
    super("Retention cleanup is not configured.");
    this.name = "RetentionCleanupConfigurationError";
  }
}

type RetentionConfiguration = Readonly<{
  abandonedUploadRetentionHours: number;
  batchSize: number;
  bucket: R2Bucket;
  failedArtifactRetentionHours: number;
  sourceRetentionHours: number;
}>;

export type RetentionCleanupResult = Readonly<{
  deletedJobs: number;
  deletedObjects: number;
  deletedSources: number;
  deletedUnattachedUploads: number;
  skipped: boolean;
}>;

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RetentionCleanupConfigurationError();
  }
  return parsed;
}

export function resolveAbandonedUploadRetentionHours(env: Env): number {
  return parseInteger(env.ABANDONED_UPLOAD_RETENTION_HOURS, 1, 168);
}

export function resolveRetentionConfiguration(env: Env): RetentionConfiguration {
  if (env.RETENTION_CLEANUP_ENABLED !== "true") {
    throw new RetentionCleanupDisabledError();
  }
  if (env.AUDIO_BUCKET === undefined) {
    throw new RetentionCleanupConfigurationError();
  }
  return {
    abandonedUploadRetentionHours: resolveAbandonedUploadRetentionHours(env),
    batchSize: parseInteger(env.RETENTION_CLEANUP_BATCH_SIZE, 1, 100),
    bucket: env.AUDIO_BUCKET,
    failedArtifactRetentionHours: parseInteger(env.FAILED_ARTIFACT_RETENTION_HOURS, 1, 168),
    sourceRetentionHours: parseInteger(env.SOURCE_RETENTION_HOURS, 1, 720),
  };
}

export function isRetentionCleanupAvailable(env: Env): boolean {
  try {
    resolveRetentionConfiguration(env);
    return true;
  } catch {
    return false;
  }
}

function objectKeys(target: JobPurgeTarget): string[] {
  return [
    ...(target.upload === null ? [] : [target.upload.objectKey]),
    ...target.outputs.map((output) => output.objectKey),
  ];
}

async function deleteObjectKeys(bucket: R2Bucket, keys: readonly string[]): Promise<number> {
  const uniqueKeys = Array.from(new Set(keys));
  if (uniqueKeys.length === 0) {
    return 0;
  }
  await bucket.delete(uniqueKeys);
  return uniqueKeys.length;
}

async function purgeClaimedUploads(
  db: D1Database,
  bucket: R2Bucket,
  targets: readonly PurgeUploadTarget[],
  capabilityCutoff: string,
): Promise<number> {
  if (targets.length === 0) {
    return 0;
  }
  const deletedObjects = await deleteObjectKeys(
    bucket,
    targets.map((target) => target.objectKey),
  );
  await finishClaimedUploadPurges(db, targets, capabilityCutoff);
  return deletedObjects;
}

export async function purgeOwnedTerminalJob(
  env: Env,
  ownerId: string,
  jobId: string,
  now: Date,
): Promise<{ deletedObjects: number; jobId: string }> {
  if (env.AUDIO_BUCKET === undefined) {
    throw new RetentionCleanupConfigurationError();
  }
  const target = await claimOwnedTerminalJobPurge(env.DB, ownerId, jobId, now.toISOString());
  const deletedObjects = await deleteObjectKeys(env.AUDIO_BUCKET, objectKeys(target));
  const capabilityCutoff = new Date(
    now.getTime() - maximumSignedR2UrlTtlSeconds * 1_000,
  ).toISOString();
  await finishOwnedJobPurge(env.DB, target.ownerId, target.jobId, capabilityCutoff);
  return { deletedObjects, jobId: target.jobId };
}

export async function purgeOwnedUnattachedUpload(
  env: Env,
  ownerId: string,
  uploadId: string,
  now: Date,
  options: Readonly<{ outstandingPutCapabilityTtlSeconds?: number }> = {},
): Promise<{ uploadId: string }> {
  if (env.AUDIO_BUCKET === undefined) {
    throw new RetentionCleanupConfigurationError();
  }
  const target = await claimOwnedUploadDeletion(env.DB, ownerId, uploadId, now.toISOString());
  await env.AUDIO_BUCKET.delete(target.objectKey);
  const capabilityTtlSeconds =
    options.outstandingPutCapabilityTtlSeconds ?? maximumSignedR2UrlTtlSeconds;
  if (
    !Number.isSafeInteger(capabilityTtlSeconds) ||
    capabilityTtlSeconds < 0 ||
    capabilityTtlSeconds > maximumSignedR2UrlTtlSeconds
  ) {
    throw new TypeError("The outstanding PUT capability lifetime is invalid.");
  }
  const capabilityCutoff = new Date(now.getTime() - capabilityTtlSeconds * 1_000).toISOString();
  const deleted = await finishOwnedUploadDeletion(
    env.DB,
    target.ownerId,
    target.id,
    capabilityCutoff,
  );
  return { uploadId: deleted.id };
}

export async function runRetentionCleanup(env: Env, now: Date): Promise<RetentionCleanupResult> {
  let configuration: RetentionConfiguration;
  try {
    configuration = resolveRetentionConfiguration(env);
  } catch (error) {
    if (error instanceof RetentionCleanupDisabledError) {
      return {
        deletedJobs: 0,
        deletedObjects: 0,
        deletedSources: 0,
        deletedUnattachedUploads: 0,
        skipped: true,
      };
    }
    throw error;
  }

  const nowIso = now.toISOString();
  const failedArtifactCutoff = new Date(
    now.getTime() - configuration.failedArtifactRetentionHours * 60 * 60 * 1_000,
  ).toISOString();
  const sourceCutoff = new Date(
    now.getTime() - configuration.sourceRetentionHours * 60 * 60 * 1_000,
  ).toISOString();
  const abandonedUploadCutoff = new Date(
    now.getTime() - configuration.abandonedUploadRetentionHours * 60 * 60 * 1_000,
  ).toISOString();
  const uploadCapabilityCutoff = new Date(
    now.getTime() - maximumSignedR2UrlTtlSeconds * 1_000,
  ).toISOString();

  let deletedJobs = 0;
  let deletedObjects = 0;
  const dueJobs = await listDueTerminalJobPurges(env.DB, {
    failedArtifactCutoff,
    limit: configuration.batchSize,
    now: nowIso,
  });
  for (const job of dueJobs) {
    try {
      const result = await purgeOwnedTerminalJob(env, job.ownerId, job.jobId, now);
      deletedObjects += result.deletedObjects;
      deletedJobs += 1;
    } catch (error) {
      if (error instanceof RepositoryNotFoundError || error instanceof RepositoryStateError) {
        continue;
      }
      throw error;
    }
  }

  const sourceTargets = await claimDueCompletedSourcePurges(env.DB, {
    cutoff: sourceCutoff,
    limit: configuration.batchSize,
  });
  deletedObjects += await purgeClaimedUploads(
    env.DB,
    configuration.bucket,
    sourceTargets,
    uploadCapabilityCutoff,
  );

  const unattachedUploadTargets = await claimDueUnattachedUploadPurges(env.DB, {
    confirmedCutoff: nowIso,
    capabilityCutoff: uploadCapabilityCutoff,
    limit: configuration.batchSize,
    pendingCutoff: abandonedUploadCutoff,
  });
  deletedObjects += await purgeClaimedUploads(
    env.DB,
    configuration.bucket,
    unattachedUploadTargets,
    uploadCapabilityCutoff,
  );

  return {
    deletedJobs,
    deletedObjects,
    deletedSources: sourceTargets.length,
    deletedUnattachedUploads: unattachedUploadTargets.length,
    skipped: false,
  };
}
