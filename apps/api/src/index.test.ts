import { describe, expect, it } from "vitest";
import { app } from "./index";

describe("StudyMix API foundation", () => {
  it("returns a healthy API envelope", async () => {
    const response = await app.request("/api/health");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        service: "studymix-api",
        status: "ok",
      },
      error: null,
      requestId: "local-foundation",
    });
  });
});
