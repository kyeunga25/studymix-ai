import { z } from "zod";
import { idempotencyKeySchema, isoDateTimeSchema } from "./common";
import { publicUploadSchema } from "./upload";

export const localAiFixtureSchema = z.literal("deterministic-tone-v1");

export const localAiScenarioSchema = z.enum(["success", "terminal-failure", "timeout-recovery"]);

export const maximumLocalAiOutputBytes = 65_536;
export const localSyntheticSourceDurationSeconds = 2;
export const localSyntheticSourceFilename = "studymix-synthetic-tone.wav";
export const localSyntheticSourceSizeBytes = 32_044;

export const createLocalSyntheticUploadRequestSchema = z
  .object({
    fixture: localAiFixtureSchema,
    idempotencyKey: idempotencyKeySchema,
    scenario: localAiScenarioSchema,
  })
  .strict();

const localSyntheticPublicUploadSchema = publicUploadSchema.extend({
  confirmedAt: isoDateTimeSchema,
  declaredContentType: z.literal("audio/wav"),
  originalFilename: z.literal(localSyntheticSourceFilename),
  sizeBytes: z.literal(localSyntheticSourceSizeBytes),
  status: z.literal("confirmed"),
});

export const localSyntheticUploadResponseSchema = z
  .object({
    request: createLocalSyntheticUploadRequestSchema,
    upload: localSyntheticPublicUploadSchema,
  })
  .strict();

export type LocalAiFixture = z.infer<typeof localAiFixtureSchema>;
export type LocalAiScenario = z.infer<typeof localAiScenarioSchema>;
export type CreateLocalSyntheticUploadRequest = z.infer<
  typeof createLocalSyntheticUploadRequestSchema
>;
export type LocalSyntheticUploadResponse = z.infer<typeof localSyntheticUploadResponseSchema>;
