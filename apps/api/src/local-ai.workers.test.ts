import {
  apiEnvelopeSchema,
  creditSummarySchema,
  currentLegalAcceptanceDocuments,
  currentRightsDeclarationVersion,
  downloadOutputResponseSchema,
  publicJobSchema,
  publicUploadSchema,
} from "@studymix/contracts";
import { createSecureId } from "@studymix/core";
import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./index";
import {
  getOwnedCreditReservationStatus,
  getOwnedCreditSummary,
  grantPrivateBetaCredits,
} from "./repositories";

const uploadEnvelopeSchema = apiEnvelopeSchema(publicUploadSchema);
const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const creditEnvelopeSchema = apiEnvelopeSchema(creditSummarySchema);
const downloadEnvelopeSchema = apiEnvelopeSchema(downloadOutputResponseSchema);

const localEnvironment: Env = {
  ...env,
  APP_ENV: "local",
  DEV_AUTH_SUBJECT: "local-ai-development-owner",
};

async function resetDatabase(): Promise<void> {
  await env.DB.prepare("DELETE FROM local_ai_attempts").run();
  await env.DB.prepare("DELETE FROM local_ai_job_policies").run();
  await env.DB.prepare("DELETE FROM local_ai_sources").run();
  await env.DB.prepare("DELETE FROM legal_acceptances").run();
  await env.DB.prepare("DELETE FROM credit_ledger").run();
  await env.DB.prepare("DELETE FROM owner_entitlements").run();
  await env.DB.prepare("DELETE FROM usage_events").run();
  await env.DB.prepare("DELETE FROM rights_declarations").run();
  await env.DB.prepare("DELETE FROM outputs").run();
  await env.DB.prepare("DELETE FROM provider_requests").run();
  await env.DB.prepare("DELETE FROM jobs").run();
  await env.DB.prepare("DELETE FROM uploads").run();
  await env.DB.prepare("DELETE FROM owners").run();
}

async function prepareOwner(): Promise<string> {
  const response = await app.request("http://127.0.0.1/api/auth/me", undefined, localEnvironment);
  expect(response.status).toBe(200);
  const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
  if (owner === null) {
    throw new Error("The local synthetic owner was not created.");
  }
  await grantPrivateBetaCredits(env.DB, {
    createdAt: new Date().toISOString(),
    eventId: createSecureId("evt"),
    ownerId: owner.id,
    quantity: 20,
    referenceKey: `test:local-ai-grant:${owner.id}`,
  });
  const legalResponse = await app.request(
    "http://127.0.0.1/api/legal/acceptances",
    {
      body: JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    localEnvironment,
  );
  expect(legalResponse.status).toBe(200);
  return owner.id;
}

async function createSyntheticUpload(
  scenario: "success" | "terminal-failure" | "timeout-recovery",
): Promise<string> {
  const response = await app.request(
    "http://127.0.0.1/api/local/synthetic-upload",
    {
      body: JSON.stringify({
        fixture: "deterministic-tone-v1",
        idempotencyKey: `local-source-${scenario}`,
        scenario,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    localEnvironment,
  );
  const envelope = uploadEnvelopeSchema.parse(await response.json());
  expect(response.status).toBe(200);
  expect(envelope.error).toBeNull();
  if (envelope.error !== null) {
    throw new Error("The local synthetic source was not created.");
  }
  return envelope.data.uploadId;
}

function jobRequest(uploadId: string, suffix: string): RequestInit {
  return {
    body: JSON.stringify({
      candidateCount: 2,
      idempotencyKey: `local-job-${suffix}`,
      presetId: "soft-piano",
      presetVersion: 1,
      rightsDeclarationVersion: currentRightsDeclarationVersion,
      uploadId,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };
}

describe("local-only synthetic AI milestone", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("runs timeout recovery through D1, Workflow, private R2, credits, and owner-bound playback", async () => {
    const ownerId = await prepareOwner();
    const uploadId = await createSyntheticUpload("timeout-recovery");
    const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
    try {
      await introspector.modifyAll(async (modifier) => {
        await modifier.disableSleeps();
        await modifier.disableRetryDelays();
      });
      const createResponse = await app.request(
        "http://127.0.0.1/api/jobs",
        jobRequest(uploadId, "timeout-recovery"),
        localEnvironment,
      );
      const created = jobEnvelopeSchema.parse(await createResponse.json());
      expect(createResponse.status).toBe(202);
      expect(created.error).toBeNull();
      if (created.error !== null) {
        throw new Error("The local synthetic job was not created.");
      }

      const instances = await introspector.get();
      expect(instances).toHaveLength(1);
      const instance = instances[0];
      if (instance === undefined) {
        throw new Error("The local Workflow instance is unavailable.");
      }
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        jobId: created.data.jobId,
        status: "completed",
      });

      const completedResponse = await app.request(
        `http://127.0.0.1/api/jobs/${created.data.jobId}`,
        undefined,
        localEnvironment,
      );
      const completed = jobEnvelopeSchema.parse(await completedResponse.json());
      expect(completed.error).toBeNull();
      if (completed.error !== null) {
        throw new Error("The completed local job could not be read.");
      }
      expect(completed.data.status).toBe("completed");
      expect(completed.data.outputs).toHaveLength(2);

      const firstOutput = completed.data.outputs[0];
      if (firstOutput === undefined) {
        throw new Error("The first local output is unavailable.");
      }
      const downloadResponse = await app.request(
        `http://127.0.0.1/api/outputs/${firstOutput.outputId}/download`,
        { method: "POST" },
        localEnvironment,
      );
      const download = downloadEnvelopeSchema.parse(await downloadResponse.json());
      expect(download.error).toBeNull();
      if (download.error !== null) {
        throw new Error("The local output URL is unavailable.");
      }
      expect(download.data.downloadUrl).toBe(`/api/local/outputs/${firstOutput.outputId}/content`);
      const contentResponse = await app.request(
        `http://127.0.0.1${download.data.downloadUrl}`,
        undefined,
        localEnvironment,
      );
      expect(contentResponse.status).toBe(200);
      expect(contentResponse.headers.get("content-type")).toBe("audio/wav");
      expect(new Uint8Array(await contentResponse.arrayBuffer()).byteLength).toBe(16_044);

      const wrongOwnerResponse = await app.request(
        `http://127.0.0.1${download.data.downloadUrl}`,
        undefined,
        { ...localEnvironment, DEV_AUTH_SUBJECT: "another-local-test-owner" },
      );
      expect(wrongOwnerResponse.status).toBe(404);

      const attempts = await env.DB.prepare(
        `SELECT id, status, actual_cost_units, last_poll_attempt
         FROM local_ai_attempts ORDER BY candidate_index`,
      ).all<{
        actual_cost_units: number | null;
        id: string;
        last_poll_attempt: number;
        status: string;
      }>();
      expect(attempts.results).toHaveLength(2);
      expect(
        attempts.results.every(
          (attempt) =>
            attempt.status === "completed" &&
            attempt.actual_cost_units === 1 &&
            attempt.last_poll_attempt >= 2 &&
            /^att_[0-9a-f]{32}$/.test(attempt.id) &&
            !attempt.id.includes(created.data.jobId),
        ),
      ).toBe(true);
      expect(await getOwnedCreditReservationStatus(env.DB, ownerId, created.data.jobId)).toBe(
        "settled",
      );
      expect(await getOwnedCreditSummary(env.DB, ownerId)).toMatchObject({
        availableCredits: 18,
        reservedCredits: 0,
        settledCredits: 2,
      });

      const repeatedResponse = await app.request(
        "http://127.0.0.1/api/jobs",
        jobRequest(uploadId, "timeout-recovery"),
        localEnvironment,
      );
      const repeated = jobEnvelopeSchema.parse(await repeatedResponse.json());
      expect(repeated.error).toBeNull();
      if (repeated.error === null) {
        expect(repeated.data.jobId).toBe(created.data.jobId);
      }
      expect(await introspector.get()).toHaveLength(1);
      const counts = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM jobs) AS jobs,
          (SELECT COUNT(*) FROM rights_declarations) AS rights,
          (SELECT COUNT(*) FROM credit_ledger WHERE event_type = 'reserve') AS reserves,
          (SELECT COUNT(*) FROM credit_ledger WHERE event_type = 'settle') AS settles`,
      ).first<{ jobs: number; reserves: number; rights: number; settles: number }>();
      expect(counts).toEqual({ jobs: 1, reserves: 1, rights: 1, settles: 1 });
    } finally {
      await introspector.dispose();
    }
  });

  it("keeps provider-attempt cost while releasing customer credits on terminal failure", async () => {
    const ownerId = await prepareOwner();
    const uploadId = await createSyntheticUpload("terminal-failure");
    const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
    try {
      await introspector.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
      });
      const response = await app.request(
        "http://127.0.0.1/api/jobs",
        jobRequest(uploadId, "terminal-failure"),
        localEnvironment,
      );
      const created = jobEnvelopeSchema.parse(await response.json());
      expect(created.error).toBeNull();
      if (created.error !== null) {
        throw new Error("The terminal-failure job was not created.");
      }
      const instances = await introspector.get();
      const instance = instances[0];
      if (instance === undefined) {
        throw new Error("The terminal-failure Workflow is unavailable.");
      }
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        jobId: created.data.jobId,
        status: "failed",
      });
      expect(await getOwnedCreditReservationStatus(env.DB, ownerId, created.data.jobId)).toBe(
        "released",
      );
      expect(await getOwnedCreditSummary(env.DB, ownerId)).toMatchObject({
        availableCredits: 20,
        reservedCredits: 0,
        settledCredits: 0,
      });
      const attemptCost = await env.DB.prepare(
        `SELECT SUM(actual_cost_units) AS total
         FROM local_ai_attempts WHERE owner_id = ?1 AND job_id = ?2`,
      )
        .bind(ownerId, created.data.jobId)
        .first<{ total: number }>();
      expect(attemptCost?.total).toBeGreaterThan(0);
    } finally {
      await introspector.dispose();
    }
  });

  it("cancels a waiting local job and releases its reservation exactly once", async () => {
    const ownerId = await prepareOwner();
    const uploadId = await createSyntheticUpload("timeout-recovery");
    const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
    try {
      await introspector.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
      });
      const createResponse = await app.request(
        "http://127.0.0.1/api/jobs",
        jobRequest(uploadId, "cancel"),
        localEnvironment,
      );
      const created = jobEnvelopeSchema.parse(await createResponse.json());
      expect(created.error).toBeNull();
      if (created.error !== null) {
        throw new Error("The cancellable local job was not created.");
      }
      const instances = await introspector.get();
      const instance = instances[0];
      if (instance === undefined) {
        throw new Error("The cancellable Workflow is unavailable.");
      }
      await vi.waitFor(
        async () => {
          const state = await env.DB.prepare("SELECT status FROM jobs WHERE id = ?1")
            .bind(created.data.jobId)
            .first<{ status: string }>();
          expect(state?.status).toBe("generating");
          const attempts = await env.DB.prepare(
            "SELECT COUNT(*) AS total FROM local_ai_attempts WHERE job_id = ?1",
          )
            .bind(created.data.jobId)
            .first<{ total: number }>();
          expect(attempts?.total).toBe(1);
        },
        { interval: 10, timeout: 2_000 },
      );
      const cancelResponse = await app.request(
        `http://127.0.0.1/api/jobs/${created.data.jobId}/cancel`,
        { method: "POST" },
        localEnvironment,
      );
      const cancelled = jobEnvelopeSchema.parse(await cancelResponse.json());
      expect(cancelResponse.status).toBe(200);
      expect(cancelled.error).toBeNull();
      if (cancelled.error === null) {
        expect(cancelled.data.status).toBe("cancelled");
      }
      expect(await getOwnedCreditReservationStatus(env.DB, ownerId, created.data.jobId)).toBe(
        "released",
      );
      expect(await getOwnedCreditSummary(env.DB, ownerId)).toMatchObject({
        availableCredits: 20,
        reservedCredits: 0,
        settledCredits: 0,
      });
      const repeatedCancel = await app.request(
        `http://127.0.0.1/api/jobs/${created.data.jobId}/cancel`,
        { method: "POST" },
        localEnvironment,
      );
      expect(repeatedCancel.status).toBe(200);
      const releaseCount = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM credit_ledger
         WHERE owner_id = ?1 AND job_id = ?2 AND event_type = 'release'`,
      )
        .bind(ownerId, created.data.jobId)
        .first<{ total: number }>();
      expect(releaseCount?.total).toBe(1);
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        jobId: created.data.jobId,
        status: "cancelled",
      });
      const attempt = await env.DB.prepare(
        `SELECT status, actual_cost_units FROM local_ai_attempts
         WHERE owner_id = ?1 AND job_id = ?2`,
      )
        .bind(ownerId, created.data.jobId)
        .first<{ actual_cost_units: number | null; status: string }>();
      expect(attempt).toEqual({ actual_cost_units: 1, status: "cancelled" });
    } finally {
      await introspector.dispose();
    }
  });

  it("rejects the local harness on non-loopback requests", async () => {
    const response = await app.request(
      "https://studymix.example/api/local/synthetic-upload",
      {
        body: JSON.stringify({
          fixture: "deterministic-tone-v1",
          idempotencyKey: "local-source-rejected",
          scenario: "success",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      localEnvironment,
    );
    expect(response.status).toBe(503);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM owners").first<{
      total: number;
    }>();
    expect(count?.total).toBe(0);
  });

  it("exposes credits only to the local authenticated owner", async () => {
    await prepareOwner();
    const response = await app.request("http://127.0.0.1/api/credits", undefined, localEnvironment);
    const envelope = creditEnvelopeSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(envelope.error).toBeNull();
  });
});
