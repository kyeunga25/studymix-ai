import { z } from "zod";

const RESOURCE_ID_SUFFIX = "[0-9a-f]{32}";

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const httpsUrlSchema = z.url().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "URL must use HTTPS.");

export const requestIdSchema = z.string().trim().min(1).max(128);

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use only letters, numbers, dots, underscores, colons, or dashes.");

export function resourceIdSchema(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_${RESOURCE_ID_SUFFIX}$`));
}

export const ownerIdSchema = resourceIdSchema("own");
export const workspaceIdSchema = resourceIdSchema("wsp");
export const uploadIdSchema = resourceIdSchema("upl");
export const jobIdSchema = resourceIdSchema("job");
export const outputIdSchema = resourceIdSchema("out");
export const rightsDeclarationIdSchema = resourceIdSchema("rgt");

export type OwnerId = z.infer<typeof ownerIdSchema>;
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type UploadId = z.infer<typeof uploadIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
export type OutputId = z.infer<typeof outputIdSchema>;
export type RightsDeclarationId = z.infer<typeof rightsDeclarationIdSchema>;
