import { z } from "zod";

export const presetIds = [
  "soft-piano",
  "music-box",
  "lofi-study",
  "acoustic-ease",
  "slowwave",
] as const;

type PresetPresentationV1 = Readonly<{
  description: Readonly<{ en: string; "zh-HK": string }>;
  displayName: Readonly<{ en: string; "zh-HK": string }>;
}>;

export const presetPresentationV1 = {
  "soft-piano": {
    displayName: { en: "Soft Piano", "zh-HK": "柔和鋼琴" },
    description: {
      en: "Gentle melody and quiet dynamics",
      "zh-HK": "柔和旋律與克制動態",
    },
  },
  "music-box": {
    displayName: { en: "Music Box", "zh-HK": "八音盒" },
    description: {
      en: "Delicate, sparse and dreamlike",
      "zh-HK": "輕盈、留白而夢幻",
    },
  },
  "lofi-study": {
    displayName: { en: "Lo-fi Study", "zh-HK": "Lo-fi 學習" },
    description: {
      en: "Warm keys and restrained soft drums",
      "zh-HK": "溫暖琴鍵與克制柔和鼓點",
    },
  },
  "acoustic-ease": {
    displayName: { en: "Acoustic Ease", "zh-HK": "木結他輕奏" },
    description: {
      en: "Light acoustic guitar with optional soft piano",
      "zh-HK": "簡約木結他，可配柔和鋼琴",
    },
  },
  slowwave: {
    displayName: { en: "Slowwave", "zh-HK": "慢拍舒緩電音" },
    description: {
      en: "Slow electronic ambience with a gentle pulse",
      "zh-HK": "慢速電子氛圍與輕柔脈動",
    },
  },
} as const satisfies Readonly<Record<(typeof presetIds)[number], PresetPresentationV1>>;

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

export const publicPresetsSchema = z.array(publicPresetSchema).length(5);

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
