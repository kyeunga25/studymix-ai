import { z } from "zod";

export const presetIds = ["soft-piano", "music-box", "lofi-study"] as const;

export const presetIdSchema = z.enum(presetIds);
export const presetVersionSchema = z.number().int().positive();

export const localizedTextSchema = z
  .object({
    en: z.string().trim().min(1),
    "zh-HK": z.string().trim().min(1),
  })
  .strict();

export const publicPresetSchema = z
  .object({
    id: presetIdSchema,
    version: presetVersionSchema,
    displayName: localizedTextSchema,
    description: localizedTextSchema,
  })
  .strict();

export const publicPresetsSchema = z.array(publicPresetSchema).length(3);

export const presetReferenceSchema = z
  .object({
    id: presetIdSchema,
    version: presetVersionSchema,
  })
  .strict();

export type PresetId = z.infer<typeof presetIdSchema>;
export type PresetVersion = z.infer<typeof presetVersionSchema>;
export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type PublicPreset = z.infer<typeof publicPresetSchema>;
export type PresetReference = z.infer<typeof presetReferenceSchema>;
