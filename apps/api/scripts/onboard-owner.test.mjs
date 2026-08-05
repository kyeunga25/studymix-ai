import { describe, expect, it } from "vitest";

import {
  buildOwnerOnboardingArgs,
  buildOwnerOnboardingEnvironment,
  buildOwnerOnboardingSql,
  hashOwnerLoginIdentity,
} from "./onboard-owner.mjs";

describe("private owner onboarding", () => {
  it("uses a keyed one-way identity hash and never places the login identity in SQL", () => {
    const privateIdentity = "owner@example.com";
    const pepper = "p".repeat(64);
    const identityHash = hashOwnerLoginIdentity(privateIdentity, pepper);
    const repeated = hashOwnerLoginIdentity(" OWNER@example.com ", pepper);
    const sql = buildOwnerOnboardingSql({
      identityHash,
      initialCreditGrant: 10,
      invitationId: `inv_${"1".repeat(32)}`,
      maxJobCreditCost: 2,
      timestamp: "2026-08-05T00:00:00.000Z",
      workspaceId: `wsp_${"2".repeat(32)}`,
    });

    expect(identityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repeated).toBe(identityHash);
    expect(sql).toContain(identityHash);
    expect(sql).not.toContain(privateIdentity);
    expect(sql).not.toContain(pepper);
    expect(sql).not.toContain("'approved'");
    expect(sql).toContain("real_provider_status = 'disabled'");
    expect(sql).toContain("payment_status = 'disabled'");
  });

  it("passes only protected file paths to Wrangler and strips private input from its environment", () => {
    expect(buildOwnerOnboardingArgs("/private/config.json", "/private/onboarding.sql")).toEqual([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--config",
      "/private/config.json",
      "--file",
      "/private/onboarding.sql",
    ]);
    expect(
      buildOwnerOnboardingEnvironment({
        OWNER_IDENTITY_PEPPER: "private-pepper",
        OWNER_LOGIN_IDENTITY: "private-identity",
        SAFE_VALUE: "kept",
        WRANGLER_LOG_PATH: "private-path",
      }),
    ).toEqual({
      SAFE_VALUE: "kept",
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_WRITE_LOGS: "false",
    });
  });
});
