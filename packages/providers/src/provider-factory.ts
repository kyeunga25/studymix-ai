import { FalMusicGenerationProvider, type FalProviderConfig } from "./fal-provider";
import { MockMusicGenerationProvider } from "./mock-provider";
import type { MusicGenerationProvider } from "./types";

export type MusicGenerationProviderConfig =
  Readonly<{ provider: "mock" }> | Readonly<{ config: FalProviderConfig; provider: "fal" }>;

export function createMusicGenerationProvider(
  config: MusicGenerationProviderConfig,
): MusicGenerationProvider {
  switch (config.provider) {
    case "mock":
      return new MockMusicGenerationProvider();
    case "fal":
      return new FalMusicGenerationProvider(config.config);
  }
}
