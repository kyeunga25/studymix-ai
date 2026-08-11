import type { JobStatus } from "@studymix/contracts";

const pendingStatuses: readonly JobStatus[] = [
  "created",
  "validating",
  "queued",
  "generating",
  "processing_output",
];

export function isPendingJob(status: JobStatus): boolean {
  return pendingStatuses.includes(status);
}

export type ActiveJobAction = "cancel" | "delete" | "retry";
