import { z } from "zod";
import { isoDateTimeSchema } from "./common";

export const entitlementPlanSchema = z.literal("private-beta");

export const entitlementStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "grace",
  "uncollectible",
  "cancelled",
]);

export const creditSummarySchema = z
  .object({
    availableCredits: z.number().int().nonnegative().safe(),
    plan: entitlementPlanSchema,
    reservedCredits: z.number().int().nonnegative().safe(),
    settledCredits: z.number().int().nonnegative().safe(),
    status: entitlementStatusSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type EntitlementPlan = z.infer<typeof entitlementPlanSchema>;
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>;
export type CreditSummary = z.infer<typeof creditSummarySchema>;
