import type { StylePreset } from "../types";

export const PRESET_VERSION = 1 as const;

export const presetsV1 = [
  {
    id: "soft-piano",
    version: PRESET_VERSION,
    displayName: {
      en: "Soft Piano",
      "zh-HK": "柔和鋼琴",
    },
    description: {
      en: "Gentle melody and quiet dynamics",
      "zh-HK": "柔和旋律與克制動態",
    },
    providerParameters: {
      targetTags:
        "instrumental, soft solo piano, recognizable central melody, gentle dynamics, sparse accompaniment, calm study music, natural piano room, no vocals",
      lyrics: "[inst]",
      editMode: "remix",
    },
    policy: {
      disallowArtistNames: true,
      instrumentalOnly: true,
    },
  },
  {
    id: "music-box",
    version: PRESET_VERSION,
    displayName: {
      en: "Music Box",
      "zh-HK": "八音盒",
    },
    description: {
      en: "Delicate, sparse and dreamlike",
      "zh-HK": "輕盈、留白而夢幻",
    },
    providerParameters: {
      targetTags:
        "instrumental, delicate music box, recognizable central melody, sparse arrangement, gentle mechanical character, calm bedtime and study music, no vocals",
      lyrics: "[inst]",
      editMode: "remix",
    },
    policy: {
      disallowArtistNames: true,
      instrumentalOnly: true,
    },
  },
  {
    id: "lofi-study",
    version: PRESET_VERSION,
    displayName: {
      en: "Lo-fi Study",
      "zh-HK": "Lo-fi 學習",
    },
    description: {
      en: "Warm keys and restrained soft drums",
      "zh-HK": "溫暖琴鍵與克制柔和鼓點",
    },
    providerParameters: {
      targetTags:
        "instrumental, relaxed lofi study music, warm electric piano, recognizable central melody, restrained soft drums, subtle tape texture, mellow dynamics, no vocals",
      lyrics: "[inst]",
      editMode: "remix",
    },
    policy: {
      disallowArtistNames: true,
      instrumentalOnly: true,
    },
  },
] as const satisfies readonly StylePreset[];
