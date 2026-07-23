import type { JobStatus } from "@studymix/contracts";

export const jobTransitions = {
  created: ["validating"],
  validating: ["queued", "failed"],
  queued: ["generating", "failed", "cancelled"],
  generating: ["processing_output", "failed", "cancelled"],
  processing_output: ["completed", "failed"],
  completed: ["expired"],
  failed: ["expired"],
  expired: [],
  cancelled: ["expired"],
} as const satisfies Readonly<Record<JobStatus, readonly JobStatus[]>>;

export class IllegalJobTransitionError extends Error {
  readonly code = "ILLEGAL_JOB_TRANSITION";

  constructor(
    readonly current: JobStatus,
    readonly next: JobStatus,
  ) {
    super(`Job cannot transition from ${current} to ${next}.`);
    this.name = "IllegalJobTransitionError";
  }
}

export function getAllowedJobTransitions(current: JobStatus): readonly JobStatus[] {
  return jobTransitions[current];
}

export function canTransitionJob(current: JobStatus, next: JobStatus): boolean {
  return getAllowedJobTransitions(current).some((allowed) => allowed === next);
}

export function transitionJobState(current: JobStatus, next: JobStatus): JobStatus {
  if (!canTransitionJob(current, next)) {
    throw new IllegalJobTransitionError(current, next);
  }

  return next;
}
