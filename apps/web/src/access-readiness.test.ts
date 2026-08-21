import { describe, expect, it } from "vitest";
import type { PrivateSession } from "./auth-session";
import { buildAccessReadiness } from "./access-readiness";

type SessionOverrides = {
  capabilities?: Partial<PrivateSession["capabilities"]>;
  paymentStatus?: PrivateSession["authorization"]["paymentStatus"];
  realProviderStatus?: PrivateSession["authorization"]["realProviderStatus"];
};

function privateSession(overrides: SessionOverrides = {}): PrivateSession {
  return {
    authorization: {
      accountStatus: "active",
      aiJobApprovalMode: "manual",
      membershipStatus: "active",
      paymentStatus: overrides.paymentStatus ?? "disabled",
      permissions: [
        "workspace:read",
        "workspace:manage",
        "jobs:create",
        "jobs:read",
        "credits:read",
        "approvals:manage",
      ],
      realProviderStatus: overrides.realProviderStatus ?? "disabled",
      role: "owner",
      workspaceStatus: "active",
    },
    capabilities: {
      creditAccounting: false,
      localAiHarness: false,
      mockGeneration: false,
      privateAudioUpload: false,
      realGeneration: false,
      retentionCleanup: false,
      ...overrides.capabilities,
    },
    kind: "development",
  };
}

describe("private workspace readiness", () => {
  it("fails closed when every optional capability and approval is disabled", () => {
    expect(buildAccessReadiness(privateSession())).toEqual([
      { id: "upload", state: "unavailable" },
      { id: "synthetic", state: "unavailable" },
      { id: "realAi", state: "unavailable" },
      { id: "credits", state: "unavailable" },
      { id: "retention", state: "unavailable" },
      { id: "payments", state: "unavailable" },
    ]);
  });

  it("labels upload and synthetic generation as local in the loopback harness", () => {
    expect(
      buildAccessReadiness(
        privateSession({
          capabilities: {
            localAiHarness: true,
            mockGeneration: true,
            privateAudioUpload: true,
          },
        }),
      ),
    ).toEqual([
      { id: "upload", state: "local" },
      { id: "synthetic", state: "local" },
      { id: "realAi", state: "unavailable" },
      { id: "credits", state: "unavailable" },
      { id: "retention", state: "unavailable" },
      { id: "payments", state: "unavailable" },
    ]);
  });

  it("keeps provider and payment controls unavailable while review is required", () => {
    expect(
      buildAccessReadiness(
        privateSession({ paymentStatus: "review_required", realProviderStatus: "review_required" }),
      ),
    ).toEqual([
      { id: "upload", state: "unavailable" },
      { id: "synthetic", state: "unavailable" },
      { id: "realAi", state: "review" },
      { id: "credits", state: "unavailable" },
      { id: "retention", state: "unavailable" },
      { id: "payments", state: "review" },
    ]);
  });

  it("distinguishes approved controls from independently disabled features", () => {
    expect(
      buildAccessReadiness(
        privateSession({ paymentStatus: "approved", realProviderStatus: "approved" }),
      ),
    ).toEqual([
      { id: "upload", state: "unavailable" },
      { id: "synthetic", state: "unavailable" },
      { id: "realAi", state: "approved-disabled" },
      { id: "credits", state: "unavailable" },
      { id: "retention", state: "unavailable" },
      { id: "payments", state: "approved-disabled" },
    ]);
  });

  it("reports only server-derived active capabilities as available", () => {
    expect(
      buildAccessReadiness(
        privateSession({
          capabilities: {
            creditAccounting: true,
            mockGeneration: true,
            privateAudioUpload: true,
            realGeneration: true,
            retentionCleanup: true,
          },
          paymentStatus: "approved",
          realProviderStatus: "approved",
        }),
      ),
    ).toEqual([
      { id: "upload", state: "available" },
      { id: "synthetic", state: "available" },
      { id: "realAi", state: "available" },
      { id: "credits", state: "available" },
      { id: "retention", state: "available" },
      { id: "payments", state: "approved-disabled" },
    ]);
  });
});
