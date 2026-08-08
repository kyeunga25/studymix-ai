import { describe, expect, it } from "vitest";
import {
  buildLoginRedirect,
  defaultPrivateDestination,
  normalizePrivateDestination,
  readLoginNavigation,
} from "./auth-navigation";

describe("authentication navigation", () => {
  it.each([
    [null, defaultPrivateDestination],
    ["/app", "/app"],
    ["/app/jobs/job_test?tab=results#candidate-2", "/app/jobs/job_test?tab=results#candidate-2"],
  ] as const)("accepts the private destination %s", (value, expected) => {
    expect(normalizePrivateDestination(value)).toBe(expected);
  });

  it.each([
    "https://outside.example/app",
    "//outside.example/app",
    "/login",
    "/app-administration",
    "/app/%2e%2e/login",
    "not a private path",
  ])("rejects the unsafe destination %s", (value) => {
    expect(normalizePrivateDestination(value)).toBe(defaultPrivateDestination);
  });

  it.each([
    ["signed-out", "session-expired"],
    ["denied", "access-denied"],
    ["unavailable", "verification-failed"],
  ] as const)("maps %s to a public login reason", (status, reason) => {
    const redirect = buildLoginRedirect(status, "/app/jobs/job_test");
    const parsed = new URL(redirect, "https://studymix.example");

    expect(parsed.pathname).toBe("/login");
    expect(parsed.searchParams.get("reason")).toBe(reason);
    expect(parsed.searchParams.get("next")).toBe("/app/jobs/job_test");
  });

  it("ignores unknown reasons and external return targets", () => {
    expect(
      readLoginNavigation("?reason=server-details&next=https%3A%2F%2Foutside.example%2Fapp"),
    ).toEqual({
      destination: defaultPrivateDestination,
      reason: null,
    });
  });
});
