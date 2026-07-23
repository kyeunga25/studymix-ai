import { describe, expect, it } from "vitest";
import { publicPresetSchema } from "@studymix/contracts";
import { listPresets, resolvePreset, toPublicPreset } from "./index";

describe("versioned style presets", () => {
  it("provides exactly the three MVP presets at version 1", () => {
    const presets = listPresets();

    expect(presets.map(({ id }) => id)).toEqual(["soft-piano", "music-box", "lofi-study"]);
    expect(presets.every(({ version }) => version === 1)).toBe(true);
  });

  it("provides non-empty English and Traditional Chinese text", () => {
    for (const preset of listPresets()) {
      expect(preset.displayName.en.length).toBeGreaterThan(0);
      expect(preset.displayName["zh-HK"].length).toBeGreaterThan(0);
      expect(preset.description.en.length).toBeGreaterThan(0);
      expect(preset.description["zh-HK"].length).toBeGreaterThan(0);
    }
  });

  it("enforces the instrumental and artist-name policy", () => {
    for (const preset of listPresets()) {
      expect(preset.policy).toEqual({
        disallowArtistNames: true,
        instrumentalOnly: true,
      });
      expect(preset.providerParameters.lyrics).toBe("[inst]");
      expect(preset.providerParameters.editMode).toBe("remix");
      expect(preset.providerParameters.targetTags).toContain("no vocals");
    }
  });

  it("resolves only an existing ID and version", () => {
    expect(resolvePreset("music-box", 1)?.displayName.en).toBe("Music Box");
    expect(resolvePreset("music-box", 2)).toBeUndefined();
  });

  it("removes internal generation parameters from the public contract", () => {
    for (const preset of listPresets()) {
      const publicPreset = toPublicPreset(preset);
      expect(publicPresetSchema.parse(publicPreset)).toEqual(publicPreset);
      expect(publicPreset).not.toHaveProperty("providerParameters");
      expect(publicPreset).not.toHaveProperty("policy");
    }
  });
});
