import { describe, expect, it } from "vitest";
import { publicPresetSchema } from "@studymix/contracts";
import { listPresets, resolvePreset, toPublicPreset } from "./index";

describe("versioned style presets", () => {
  it("provides exactly the six MVP presets at version 1", () => {
    const presets = listPresets();

    expect(presets.map(({ id }) => id)).toEqual([
      "soft-piano",
      "music-box",
      "lofi-study",
      "acoustic-ease",
      "slowwave",
      "kissa-jazzhop",
    ]);
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
    expect(resolvePreset("acoustic-ease", 1)?.displayName["zh-HK"]).toBe("木結他輕奏");
    expect(resolvePreset("slowwave", 1)?.displayName.en).toBe("Slowwave");
    expect(resolvePreset("kissa-jazzhop", 1)?.displayName["zh-HK"]).toBe("喫茶爵士輕拍");
    expect(resolvePreset("music-box", 2)).toBeUndefined();
  });

  it("keeps the expanded styles bounded and instrumental", () => {
    const acoustic = resolvePreset("acoustic-ease", 1);
    const slowwave = resolvePreset("slowwave", 1);
    const jazzhop = resolvePreset("kissa-jazzhop", 1);

    expect(acoustic?.providerParameters.targetTags).toContain("acoustic guitar");
    expect(acoustic?.providerParameters.targetTags).toContain("soft piano");
    expect(slowwave?.providerParameters.targetTags).toContain("slow-paced ambient electronic");
    expect(slowwave?.providerParameters.targetTags).toContain("gentle pulse");
    expect(jazzhop?.providerParameters.targetTags).toContain("relaxed jazz-hop");
    expect(jazzhop?.providerParameters.targetTags).toContain("warm jazz piano chords");
    expect(jazzhop?.providerParameters.targetTags).toContain("restrained boom-bap groove");
    expect(jazzhop?.providerParameters.targetTags).toContain("cafe ambience");
    expect(acoustic?.providerParameters.targetTags).not.toMatch(/artist|singer|band/i);
    expect(slowwave?.providerParameters.targetTags).not.toMatch(/artist|singer|band/i);
    expect(jazzhop?.providerParameters.targetTags).not.toMatch(/artist|singer|band/i);
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
