import { describe, expect, it, vi } from "vitest";
import { createMusicGenerationProvider } from "./provider-factory";

describe("music generation provider factory", () => {
  it("keeps the mock provider available without paid credentials", () => {
    expect(createMusicGenerationProvider({ provider: "mock" }).name).toBe("mock");
  });

  it("creates the fal adapter with an injected offline queue", () => {
    const provider = createMusicGenerationProvider({
      config: {
        outputExpirationSeconds: 3_600,
        queue: {
          cancel: vi.fn(async () => undefined),
          result: vi.fn(async () => ({})),
          status: vi.fn(async () => ({})),
          submit: vi.fn(async () => ({})),
        },
      },
      provider: "fal",
    });

    expect(provider.name).toBe("fal");
  });
});
