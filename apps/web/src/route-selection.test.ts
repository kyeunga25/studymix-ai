import { describe, expect, it } from "vitest";
import { resolveAppRoute } from "./route-selection";

describe("application route selection", () => {
  it.each(["/", "/index.html"])("selects the public landing route for %s", (path) => {
    expect(resolveAppRoute(path)).toEqual({ kind: "landing" });
  });

  it("selects the exact login route", () => {
    expect(resolveAppRoute("/login")).toEqual({ kind: "login" });
  });

  it.each([
    ["/legal/terms", "terms-of-use"],
    ["/legal/privacy", "privacy-notice"],
    ["/legal/acceptable-use", "acceptable-use"],
    ["/legal/ai-output-notice", "ai-output-notice"],
  ] as const)("maps %s to the versioned legal document %s", (path, documentId) => {
    expect(resolveAppRoute(path)).toEqual({ documentId, kind: "legal" });
  });

  it.each(["/app", "/app/jobs/job_test"])("selects the private route for %s", (path) => {
    expect(resolveAppRoute(path)).toEqual({ kind: "private" });
  });

  it.each(["/unknown", "/login/extra", "/legal/terms/extra", "/app-administration"])(
    "keeps the unknown or lookalike path %s on the public landing route",
    (path) => {
      expect(resolveAppRoute(path)).toEqual({ kind: "landing" });
    },
  );
});
