import { z } from "zod";
import { idempotencyKeySchema } from "./common";

export const localAiFixtureSchema = z.literal("deterministic-tone-v1");

export const localAiScenarioSchema = z.enum(["success", "terminal-failure", "timeout-recovery"]);

export const createLocalSyntheticUploadRequestSchema = z
  .object({
    fixture: localAiFixtureSchema,
    idempotencyKey: idempotencyKeySchema,
    scenario: localAiScenarioSchema,
  })
  .strict();

export type LocalAiFixture = z.infer<typeof localAiFixtureSchema>;
export type LocalAiScenario = z.infer<typeof localAiScenarioSchema>;
export type CreateLocalSyntheticUploadRequest = z.infer<
  typeof createLocalSyntheticUploadRequestSchema
>;
