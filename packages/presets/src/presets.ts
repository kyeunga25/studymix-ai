import type { PresetId } from "@studymix/contracts";
import { presetsV1 } from "./versions/v1";
import type { ResolvedStylePreset, StylePreset } from "./types";

const allPresets: readonly StylePreset[] = presetsV1;

export function listPresets(): readonly StylePreset[] {
  return allPresets;
}

export function resolvePreset(id: PresetId, version: number): ResolvedStylePreset | undefined {
  return allPresets.find((preset) => preset.id === id && preset.version === version);
}
