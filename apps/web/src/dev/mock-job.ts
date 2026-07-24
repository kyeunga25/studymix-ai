import type { PresetId } from "@studymix/contracts";
import { createJob } from "../job-api";

const localMockUploadId = "upl_00000000000000000000000000000001";

export async function startLocalMockJob(presetId: PresetId) {
  const job = await createJob({
    candidateCount: 2,
    idempotencyKey: `ui:${crypto.randomUUID()}`,
    presetId,
    presetVersion: 1,
    rightsDeclarationVersion: "v1",
    uploadId: localMockUploadId,
  });
  return {
    candidateSources: [
      "/__studymix-mock/candidate-0.wav",
      "/__studymix-mock/candidate-1.wav",
    ] as const,
    job,
  };
}
