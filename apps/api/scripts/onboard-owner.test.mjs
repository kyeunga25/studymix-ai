import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildOwnerOnboardingArgs,
  buildOwnerOnboardingEnvironment,
  buildOwnerOnboardingSql,
  hashOwnerLoginIdentity,
} from "./onboard-owner.mjs";

const migrationUrls = [
  new URL("../migrations/0001_metadata_schema.sql", import.meta.url),
  new URL("../migrations/0002_legal_acceptances.sql", import.meta.url),
  new URL("../migrations/0003_jobs_owner_created_index.sql", import.meta.url),
  new URL("../migrations/0004_beta_credit_ledger.sql", import.meta.url),
  new URL("../migrations/0005_owner_workspaces.sql", import.meta.url),
  new URL("../migrations/0006_upload_idempotency.sql", import.meta.url),
];
const baseOnboardingInput = {
  identityHash: "a".repeat(64),
  initialCreditGrant: 10,
  invitationId: `inv_${"1".repeat(32)}`,
  maxJobCreditCost: 2,
  timestamp: "2026-08-05T00:00:00.000Z",
  workspaceId: `wsp_${"2".repeat(32)}`,
};

function createOnboardingDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const migrationUrl of migrationUrls) {
    database.exec(readFileSync(migrationUrl, "utf8"));
  }
  return database;
}

describe("private owner onboarding", () => {
  it("uses a keyed one-way identity hash and never places the login identity in SQL", () => {
    const privateIdentity = "owner@example.test";
    const pepper = "p".repeat(64);
    const identityHash = hashOwnerLoginIdentity(privateIdentity, pepper);
    const repeated = hashOwnerLoginIdentity(" OWNER@example.test ", pepper);
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

  it("rejects an onboarding grant above the bounded beta-test limit", () => {
    expect(() =>
      buildOwnerOnboardingSql({
        identityHash: "a".repeat(64),
        initialCreditGrant: 1_001,
        invitationId: `inv_${"1".repeat(32)}`,
        maxJobCreditCost: 2,
        timestamp: "2026-08-05T00:00:00.000Z",
        workspaceId: `wsp_${"2".repeat(32)}`,
      }),
    ).toThrow();
  });

  it("allows pending or revoked invitation terms to change before consumption", () => {
    const database = createOnboardingDatabase();
    try {
      database.exec(buildOwnerOnboardingSql(baseOnboardingInput));
      database.exec(
        buildOwnerOnboardingSql({
          ...baseOnboardingInput,
          initialCreditGrant: 12,
          invitationId: `inv_${"3".repeat(32)}`,
          maxJobCreditCost: 3,
          timestamp: "2026-08-05T00:01:00.000Z",
          workspaceId: `wsp_${"4".repeat(32)}`,
        }),
      );
      expect(
        database
          .prepare(
            `SELECT initial_credit_grant, max_job_credit_cost, status
             FROM owner_invitations`,
          )
          .get(),
      ).toMatchObject({ initial_credit_grant: 12, max_job_credit_cost: 3, status: "pending" });

      database.exec("UPDATE owner_invitations SET status = 'revoked'");
      database.exec(
        buildOwnerOnboardingSql({
          ...baseOnboardingInput,
          initialCreditGrant: 14,
          invitationId: `inv_${"5".repeat(32)}`,
          maxJobCreditCost: 4,
          timestamp: "2026-08-05T00:02:00.000Z",
          workspaceId: `wsp_${"6".repeat(32)}`,
        }),
      );
      expect(
        database
          .prepare(
            `SELECT initial_credit_grant, max_job_credit_cost, status
             FROM owner_invitations`,
          )
          .get(),
      ).toMatchObject({ initial_credit_grant: 14, max_job_credit_cost: 4, status: "pending" });
    } finally {
      database.close();
    }
  });

  it("keeps a consumed invitation grant immutable across onboarding replays", () => {
    const database = createOnboardingDatabase();
    const ownerId = `own_${"7".repeat(32)}`;
    try {
      database.exec(buildOwnerOnboardingSql(baseOnboardingInput));
      database
        .prepare(
          `INSERT INTO owners (
            id, kind, auth_issuer, auth_subject_hash, status, created_at, last_seen_at
          ) VALUES (?1, 'authenticated', ?2, ?3, 'active', ?4, ?4)`,
        )
        .run(ownerId, "https://example.test", "8".repeat(64), baseOnboardingInput.timestamp);
      database
        .prepare(
          `UPDATE owner_invitations
           SET status = 'consumed', claimed_owner_id = ?1,
             consumed_at = ?2, updated_at = ?2
           WHERE login_identity_hash = ?3`,
        )
        .run(ownerId, baseOnboardingInput.timestamp, baseOnboardingInput.identityHash);
      database
        .prepare(
          `INSERT INTO credit_ledger (
            id, owner_id, job_id, event_type, quantity, reference_key, created_at
          ) VALUES (?1, ?2, NULL, 'grant', ?3, ?4, ?5)`,
        )
        .run(
          `evt_${"1".repeat(32)}`,
          ownerId,
          baseOnboardingInput.initialCreditGrant,
          `onboarding:${baseOnboardingInput.invitationId}`,
          baseOnboardingInput.timestamp,
        );

      database.exec(
        buildOwnerOnboardingSql({
          ...baseOnboardingInput,
          initialCreditGrant: 20,
          invitationId: `inv_${"9".repeat(32)}`,
          maxJobCreditCost: 5,
          timestamp: "2026-08-05T00:03:00.000Z",
          workspaceId: `wsp_${"a".repeat(32)}`,
        }),
      );
      const invitation = database
        .prepare(
          `SELECT initial_credit_grant, max_job_credit_cost, status
           FROM owner_invitations`,
        )
        .get();
      const grant = database
        .prepare(
          `SELECT COUNT(*) AS events, event_type, quantity
           FROM credit_ledger
           WHERE owner_id = ?1 AND reference_key = ?2`,
        )
        .get(ownerId, `onboarding:${baseOnboardingInput.invitationId}`);

      expect(invitation).toMatchObject({
        initial_credit_grant: 10,
        max_job_credit_cost: 5,
        status: "consumed",
      });
      expect(grant).toMatchObject({ events: 1, event_type: "grant", quantity: 10 });
    } finally {
      database.close();
    }
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
        WRANGLER_SEND_METRICS: "true",
      }),
    ).toEqual({
      SAFE_VALUE: "kept",
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
    });
  });
});
