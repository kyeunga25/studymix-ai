import type { LocalizedText, PresetId, PublicPreset } from "@studymix/contracts";

export type StylePreset = Readonly<{
  id: PresetId;
  version: 1;
  displayName: Readonly<LocalizedText>;
  description: Readonly<LocalizedText>;
  providerParameters: Readonly<{
    targetTags: string;
    lyrics: "[inst]";
    editMode: "remix";
  }>;
  policy: Readonly<{
    disallowArtistNames: true;
    instrumentalOnly: true;
  }>;
}>;

export type ResolvedStylePreset = StylePreset;

export function toPublicPreset(preset: StylePreset): PublicPreset {
  return {
    id: preset.id,
    version: preset.version,
    displayName: { ...preset.displayName },
    description: { ...preset.description },
  };
}
