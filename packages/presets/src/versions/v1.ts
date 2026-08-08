import { presetPresentationV1 } from "@studymix/contracts";
import type { StylePreset } from "../types";

export const PRESET_VERSION = 1 as const;

export const presetsV1 = [
  {
    id: "soft-piano",
    version: PRESET_VERSION,
    ...presetPresentationV1["soft-piano"],
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
    ...presetPresentationV1["music-box"],
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
    ...presetPresentationV1["lofi-study"],
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
  {
    id: "acoustic-ease",
    version: PRESET_VERSION,
    ...presetPresentationV1["acoustic-ease"],
    providerParameters: {
      targetTags:
        "instrumental, simple acoustic guitar, optional soft piano accompaniment, recognizable central melody, light fingerpicked arrangement, gentle dynamics, warm natural room, calm study music, no vocals",
      lyrics: "[inst]",
      editMode: "remix",
    },
    policy: {
      disallowArtistNames: true,
      instrumentalOnly: true,
    },
  },
  {
    id: "slowwave",
    version: PRESET_VERSION,
    ...presetPresentationV1.slowwave,
    providerParameters: {
      targetTags:
        "instrumental, slow-paced ambient electronic music, recognizable central melody, soft synth pads, gentle pulse, restrained percussion, warm spacious texture, calm study music, no vocals",
      lyrics: "[inst]",
      editMode: "remix",
    },
    policy: {
      disallowArtistNames: true,
      instrumentalOnly: true,
    },
  },
] as const satisfies readonly StylePreset[];
