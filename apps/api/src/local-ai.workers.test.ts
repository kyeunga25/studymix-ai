import {
  apiEnvelopeSchema,
  creditSummarySchema,
  currentLegalAcceptanceDocuments,
  currentRightsDeclarationVersion,
  downloadOutputResponseSchema,
  localSyntheticUploadResponseSchema,
  publicJobHistorySchema,
  publicJobSchema,
} from "@studymix/contracts";
import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { createSecureId } from "@studymix/core";
import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./index";
import {
  createJobIdempotently,
  getOwnedCreditReservationStatus,
  getOwnedCreditSummary,
  grantPrivateBetaCredits,
} from "./repositories";

const localSourceEnvelopeSchema = apiEnvelopeSchema(localSyntheticUploadResponseSchema);
const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const jobHistoryEnvelopeSchema = apiEnvelopeSchema(publicJobHistorySchema);
const creditEnvelopeSchema = apiEnvelopeSchema(creditSummarySchema);
const downloadEnvelopeSchema = apiEnvelopeSchema(downloadOutputResponseSchema);
const browserMutationHeaders = {
  [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
} as const;
const jsonBrowserMutationHeaders = {
  ...browserMutationHeaders,
  "Content-Type": "application/json",
} as const;

const localEnvironment: Env = {
  ...env,
  APP_ENV: "local",
  DEV_AUTH_SUBJECT: "local-ai-development-owner",
};
const validSyntheticUploadRequestBody = {
  fixture: "deterministic-tone-v1",
  idempotencyKey: "local-source-request-0001",
  scenario: "success",
} as const;
const invalidSyntheticUploadRequestCases = [
  {
    body: JSON.stringify(validSyntheticUploadRequestBody),
    contentType: "text/plain",
    expectedStatus: 415,
    label: "a non-JSON media type",
  },
  {
    body: "{",
    contentType: "application/json",
    expectedStatus: 400,
    label: "malformed JSON",
  },
  {
    body: JSON.stringify({ padding: "x".repeat(4_096) }),
    contentType: "application/json",
    expectedStatus: 413,
    label: "a JSON body over 4 KiB",
  },
  {
    body: JSON.stringify({ ...validSyntheticUploadRequestBody, unexpected: true }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an extra request field",
  },
  {
    body: JSON.stringify({ ...validSyntheticUploadRequestBody, fixture: "unknown-fixture" }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an unknown fixture",
  },
  {
    body: JSON.stringify({ ...validSyntheticUploadRequestBody, scenario: "unknown-scenario" }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an unknown scenario",
  },
  {
    body: JSON.stringify({ ...validSyntheticUploadRequestBody, idempotencyKey: "" }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an empty idempotency key",
  },
] satisfies readonly Readonly<{
  body: string;
  contentType: string;
  expectedStatus: 400 | 413 | 415;
  label: string;
}>[];

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
  await env.DB.prepare("DELETE FROM workspace_memberships").run();
  await env.DB.prepare("DELETE FROM workspace_controls").run();
  await env.DB.prepare("DELETE FROM owner_invitations").run();
  await env.DB.prepare("DELETE FROM workspaces").run();
  await env.DB.prepare("DELETE FROM owners").run();
}

async function prepareOwner(): Promise<string> {
  const response = await app.request(
    "http://127.0.0.1/api/auth/me",
    { headers: browserMutationHeaders },
    localEnvironment,
  );
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
      headers: jsonBrowserMutationHeaders,
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
  const request = {
    fixture: "deterministic-tone-v1",
    idempotencyKey: `local-source-${scenario}`,
    scenario,
  } as const;
  const response = await app.request(
    "http://127.0.0.1/api/local/synthetic-upload",
    {
      body: JSON.stringify(request),
      headers: jsonBrowserMutationHeaders,
      method: "POST",
    },
    localEnvironment,
  );
  const envelope = localSourceEnvelopeSchema.parse(await response.json());
  expect(response.status).toBe(200);
  expect(envelope.error).toBeNull();
  if (envelope.error !== null) {
    throw new Error("The local synthetic source was not created.");
  }
  expect(envelope.data.request).toEqual(request);
  return envelope.data.upload.uploadId;
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
    headers: jsonBrowserMutationHeaders,
    method: "POST",
  };
}

describe("local-only synthetic AI milestone", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each(invalidSyntheticUploadRequestCases)(
    "rejects $label before creating a synthetic source",
    async ({ body, contentType, expectedStatus }) => {
      const objectKeysBefore = (await env.AUDIO_BUCKET.list()).objects
        .map((object) => object.key)
        .sort();
      const response = await app.request(
        "http://127.0.0.1/api/local/synthetic-upload",
        {
          body,
          headers: { ...browserMutationHeaders, "Content-Type": contentType },
          method: "POST",
        },
        localEnvironment,
      );
      const responseBody: unknown = await response.json();
      const sideEffects = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM uploads) AS uploads,
          (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources`,
      ).first<{ local_ai_sources: number; uploads: number }>();
      const objectKeysAfter = (await env.AUDIO_BUCKET.list()).objects
        .map((object) => object.key)
        .sort();

      expect(response.status).toBe(expectedStatus);
      expect(responseBody).toMatchObject({
        data: null,
        error: { code: "VALIDATION_ERROR", retryable: false },
      });
      expect(JSON.stringify(responseBody)).not.toContain("local-source-request");
      expect(sideEffects).toEqual({ local_ai_sources: 0, uploads: 0 });
      expect(objectKeysAfter).toEqual(objectKeysBefore);
    },
  );

  it("replays one synthetic source idempotently without duplicating D1 or R2 data", async () => {
    const objectCountBefore = (await env.AUDIO_BUCKET.list()).objects.length;
    const firstUploadId = await createSyntheticUpload("success");
    const secondUploadId = await createSyntheticUpload("success");
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads) AS uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources`,
    ).first<{ local_ai_sources: number; uploads: number }>();
    const objects = await env.AUDIO_BUCKET.list();

    expect(secondUploadId).toBe(firstUploadId);
    expect(counts).toEqual({ local_ai_sources: 1, uploads: 1 });
    expect(objects.objects).toHaveLength(objectCountBefore + 1);
  });

  it("lists a minimal owner job history even when new generation is disabled", async () => {
    const ownerId = await prepareOwner();
    const uploadId = await createSyntheticUpload("success");
    const createdAt = new Date().toISOString();
    const created = await createJobIdempotently(env.DB, {
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 60 * 60 * 1_000).toISOString(),
      id: createSecureId("job"),
      idempotencyKey: "local-job-history",
      maxActiveJobs: 2,
      ownerId,
      presetId: "soft-piano",
      presetVersion: 1,
      provider: "mock",
      requestFingerprint: "a".repeat(64),
      uploadId,
    });

    const response = await app.request(
      "http://127.0.0.1/api/jobs",
      { headers: browserMutationHeaders },
      {
        ...localEnvironment,
        JOB_WORKFLOW_ENABLED: "false",
        REAL_GENERATION_ENABLED: "false",
      },
    );
    const rawHistory: unknown = await response.json();
    const history = jobHistoryEnvelopeSchema.parse(rawHistory);

    expect(response.status).toBe(200);
    expect(history.error).toBeNull();
    if (history.error !== null || history.data === null) {
      throw new Error("The owner job history was not returned.");
    }
    expect(history.data.jobs).toEqual([
      {
        createdAt: created.job.createdAt,
        expiresAt: created.job.expiresAt,
        jobId: created.job.id,
        preset: { id: created.job.presetId, version: created.job.presetVersion },
        status: created.job.status,
        updatedAt: created.job.updatedAt,
      },
    ]);
    expect(JSON.stringify(rawHistory)).not.toContain(uploadId);
    expect(JSON.stringify(rawHistory)).not.toContain("provider");
    expect(JSON.stringify(rawHistory)).not.toContain("outputs");
  });

  it("keeps a deleted source key tombstoned for its owner without blocking another owner", async () => {
    const firstUploadId = await createSyntheticUpload("success");
    const deleted = await app.request(
      `http://127.0.0.1/api/uploads/${firstUploadId}`,
      { headers: browserMutationHeaders, method: "DELETE" },
      localEnvironment,
    );
    expect(deleted.status).toBe(200);

    const objectKeysAfterDelete = (await env.AUDIO_BUCKET.list()).objects
      .map((object) => object.key)
      .sort();
    const replay = await app.request(
      "http://127.0.0.1/api/local/synthetic-upload",
      {
        body: JSON.stringify({
          fixture: "deterministic-tone-v1",
          idempotencyKey: "local-source-success",
          scenario: "success",
        }),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      localEnvironment,
    );
    const replayBody: unknown = await replay.json();
    const stateAfterReplay = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads) AS uploads,
        (SELECT COUNT(*) FROM uploads WHERE status = 'deleted') AS deleted_uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources`,
    ).first<{ deleted_uploads: number; local_ai_sources: number; uploads: number }>();

    expect(replay.status).toBe(409);
    expect(replayBody).toMatchObject({
      data: null,
      error: { code: "CONFLICT", retryable: false },
    });
    expect(JSON.stringify(replayBody)).not.toContain(firstUploadId);
    expect(stateAfterReplay).toEqual({ deleted_uploads: 1, local_ai_sources: 1, uploads: 1 });
    expect((await env.AUDIO_BUCKET.list()).objects.map((object) => object.key).sort()).toEqual(
      objectKeysAfterDelete,
    );

    const otherOwner = await app.request(
      "http://127.0.0.1/api/local/synthetic-upload",
      {
        body: JSON.stringify({
          fixture: "deterministic-tone-v1",
          idempotencyKey: "local-source-success",
          scenario: "success",
        }),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      { ...localEnvironment, DEV_AUTH_SUBJECT: "deleted-key-other-owner" },
    );
    const otherOwnerEnvelope = localSourceEnvelopeSchema.parse(await otherOwner.json());
    expect(otherOwner.status).toBe(200);
    expect(otherOwnerEnvelope.error).toBeNull();
    if (otherOwnerEnvelope.error !== null) {
      throw new Error("The other owner's independent local source was not created.");
    }
    expect(otherOwnerEnvelope.data.upload.uploadId).not.toBe(firstUploadId);
    const finalState = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads) AS uploads,
        (SELECT COUNT(*) FROM uploads WHERE status = 'confirmed') AS confirmed_uploads,
        (SELECT COUNT(*) FROM uploads WHERE status = 'deleted') AS deleted_uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources,
        (SELECT COUNT(DISTINCT owner_id) FROM local_ai_sources) AS owners`,
    ).first<{
      confirmed_uploads: number;
      deleted_uploads: number;
      local_ai_sources: number;
      owners: number;
      uploads: number;
    }>();
    expect(finalState).toEqual({
      confirmed_uploads: 1,
      deleted_uploads: 1,
      local_ai_sources: 2,
      owners: 2,
      uploads: 2,
    });
    expect((await env.AUDIO_BUCKET.list()).objects).toHaveLength(objectKeysAfterDelete.length + 1);
  });

  it("converges simultaneous equivalent source requests without an orphan object", async () => {
    const objectCountBefore = (await env.AUDIO_BUCKET.list()).objects.length;
    const [firstUploadId, secondUploadId] = await Promise.all([
      createSyntheticUpload("success"),
      createSyntheticUpload("success"),
    ]);
    const state = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads WHERE status = 'confirmed') AS confirmed_uploads,
        (SELECT COUNT(*) FROM uploads WHERE status = 'deleted') AS deleted_uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources`,
    ).first<{
      confirmed_uploads: number;
      deleted_uploads: number;
      local_ai_sources: number;
    }>();

    expect(secondUploadId).toBe(firstUploadId);
    expect(state).toEqual({
      confirmed_uploads: 1,
      deleted_uploads: 1,
      local_ai_sources: 1,
    });
    expect((await env.AUDIO_BUCKET.list()).objects).toHaveLength(objectCountBefore + 1);
  });

  it("rejects reusing one owner idempotency key for a different scenario", async () => {
    const objectCountBefore = (await env.AUDIO_BUCKET.list()).objects.length;
    await createSyntheticUpload("success");
    const response = await app.request(
      "http://127.0.0.1/api/local/synthetic-upload",
      {
        body: JSON.stringify({
          fixture: "deterministic-tone-v1",
          idempotencyKey: "local-source-success",
          scenario: "terminal-failure",
        }),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      localEnvironment,
    );
    const responseBody: unknown = await response.json();
    const state = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads) AS uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources,
        (SELECT scenario FROM local_ai_sources LIMIT 1) AS scenario`,
    ).first<{ local_ai_sources: number; scenario: string; uploads: number }>();

    expect(response.status).toBe(409);
    expect(responseBody).toMatchObject({
      data: null,
      error: { code: "CONFLICT", retryable: false },
    });
    expect(JSON.stringify(responseBody)).not.toContain("terminal-failure");
    expect(state).toEqual({ local_ai_sources: 1, scenario: "success", uploads: 1 });
    expect((await env.AUDIO_BUCKET.list()).objects).toHaveLength(objectCountBefore + 1);
  });

  it("serializes simultaneous conflicting source requests for one owner key", async () => {
    const objectCountBefore = (await env.AUDIO_BUCKET.list()).objects.length;
    const responses = await Promise.all(
      (["success", "terminal-failure"] as const).map((scenario) =>
        app.request(
          "http://127.0.0.1/api/local/synthetic-upload",
          {
            body: JSON.stringify({
              fixture: "deterministic-tone-v1",
              idempotencyKey: "concurrent-conflicting-source",
              scenario,
            }),
            headers: jsonBrowserMutationHeaders,
            method: "POST",
          },
          localEnvironment,
        ),
      ),
    );
    const responseBodies: unknown[] = await Promise.all(
      responses.map(async (response) => {
        const body: unknown = await response.json();
        return body;
      }),
    );
    const conflictBody = responseBodies[responses.findIndex((response) => response.status === 409)];
    const state = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads WHERE status = 'confirmed') AS confirmed_uploads,
        (SELECT COUNT(*) FROM uploads WHERE status = 'deleted') AS deleted_uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources`,
    ).first<{
      confirmed_uploads: number;
      deleted_uploads: number;
      local_ai_sources: number;
    }>();

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(conflictBody).toMatchObject({
      data: null,
      error: { code: "CONFLICT", retryable: false },
    });
    expect(JSON.stringify(conflictBody)).not.toContain("terminal-failure");
    expect(state?.confirmed_uploads).toBe(1);
    expect(state?.local_ai_sources).toBe(1);
    expect(state?.deleted_uploads).toBeLessThanOrEqual(1);
    expect((await env.AUDIO_BUCKET.list()).objects).toHaveLength(objectCountBefore + 1);
  });

  it("scopes a shared local source idempotency key to each synthetic owner", async () => {
    const objectCountBefore = (await env.AUDIO_BUCKET.list()).objects.length;
    const sharedRequest = {
      body: JSON.stringify({
        fixture: "deterministic-tone-v1",
        idempotencyKey: "shared-local-source-key",
        scenario: "success",
      }),
      headers: jsonBrowserMutationHeaders,
      method: "POST",
    } satisfies RequestInit;
    const first = await app.request(
      "http://127.0.0.1/api/local/synthetic-upload",
      sharedRequest,
      localEnvironment,
    );
    const second = await app.request("http://127.0.0.1/api/local/synthetic-upload", sharedRequest, {
      ...localEnvironment,
      DEV_AUTH_SUBJECT: "another-local-ai-owner",
    });
    const firstEnvelope = localSourceEnvelopeSchema.parse(await first.json());
    const secondEnvelope = localSourceEnvelopeSchema.parse(await second.json());
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads) AS uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources,
        (SELECT COUNT(DISTINCT owner_id) FROM local_ai_sources) AS owners`,
    ).first<{ local_ai_sources: number; owners: number; uploads: number }>();

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(firstEnvelope.error).toBeNull();
    expect(secondEnvelope.error).toBeNull();
    if (firstEnvelope.error !== null || secondEnvelope.error !== null) {
      throw new Error("The owner-scoped local sources were not created.");
    }
    expect(secondEnvelope.data.upload.uploadId).not.toBe(firstEnvelope.data.upload.uploadId);
    expect(counts).toEqual({ local_ai_sources: 2, owners: 2, uploads: 2 });
    expect((await env.AUDIO_BUCKET.list()).objects).toHaveLength(objectCountBefore + 2);
  });

  it("hides the synthetic source route when a required local capability is disabled", async () => {
    const disabledEnvironment: Env = { ...localEnvironment, JOB_WORKFLOW_ENABLED: "false" };
    const objectKeysBefore = (await env.AUDIO_BUCKET.list()).objects
      .map((object) => object.key)
      .sort();
    const response = await app.request(
      "http://127.0.0.1/api/local/synthetic-upload",
      {
        body: JSON.stringify(validSyntheticUploadRequestBody),
        headers: jsonBrowserMutationHeaders,
        method: "POST",
      },
      disabledEnvironment,
    );
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM uploads) AS uploads,
        (SELECT COUNT(*) FROM local_ai_sources) AS local_ai_sources`,
    ).first<{ local_ai_sources: number; uploads: number }>();
    const objectKeysAfter = (await env.AUDIO_BUCKET.list()).objects
      .map((object) => object.key)
      .sort();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(counts).toEqual({ local_ai_sources: 0, uploads: 0 });
    expect(objectKeysAfter).toEqual(objectKeysBefore);
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
        { headers: browserMutationHeaders },
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
        { headers: browserMutationHeaders, method: "POST" },
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
        { headers: browserMutationHeaders },
        localEnvironment,
      );
      expect(contentResponse.status).toBe(200);
      expect(contentResponse.headers.get("content-type")).toBe("audio/wav");
      expect(new Uint8Array(await contentResponse.arrayBuffer()).byteLength).toBe(16_044);

      const wrongOwnerResponse = await app.request(
        `http://127.0.0.1${download.data.downloadUrl}`,
        { headers: browserMutationHeaders },
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
      const deniedCancel = await app.request(
        `http://127.0.0.1/api/jobs/${created.data.jobId}/cancel`,
        { headers: browserMutationHeaders, method: "POST" },
        { ...localEnvironment, DEV_AUTH_SUBJECT: "another-local-cancel-owner" },
      );
      const protectedState = await env.DB.prepare(
        `SELECT
          (SELECT status FROM jobs WHERE id = ?1 AND owner_id = ?2) AS job_status,
          (SELECT COUNT(*) FROM local_ai_attempts
           WHERE job_id = ?1 AND owner_id = ?2) AS owner_attempts,
          (SELECT COUNT(*) FROM local_ai_attempts
           WHERE job_id = ?1 AND owner_id <> ?2) AS other_attempts`,
      )
        .bind(created.data.jobId, ownerId)
        .first<{ job_status: string; other_attempts: number; owner_attempts: number }>();
      expect(deniedCancel.status).toBe(404);
      expect(await deniedCancel.json()).toMatchObject({
        data: null,
        error: { code: "NOT_FOUND", retryable: false },
      });
      expect(protectedState).toEqual({
        job_status: "generating",
        other_attempts: 0,
        owner_attempts: 1,
      });
      expect(await getOwnedCreditReservationStatus(env.DB, ownerId, created.data.jobId)).toBe(
        "reserved",
      );
      expect(await getOwnedCreditSummary(env.DB, ownerId)).toMatchObject({
        availableCredits: 18,
        reservedCredits: 2,
        settledCredits: 0,
      });
      const cancelResponse = await app.request(
        `http://127.0.0.1/api/jobs/${created.data.jobId}/cancel`,
        { headers: browserMutationHeaders, method: "POST" },
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
        { headers: browserMutationHeaders, method: "POST" },
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
        headers: jsonBrowserMutationHeaders,
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

  it("keeps the credit aggregate scoped to the local authenticated owner", async () => {
    await prepareOwner();
    const response = await app.request(
      "http://127.0.0.1/api/credits",
      { headers: browserMutationHeaders },
      localEnvironment,
    );
    const envelope = creditEnvelopeSchema.parse(await response.json());
    const denied = await app.request(
      "http://127.0.0.1/api/credits",
      { headers: browserMutationHeaders },
      {
        ...localEnvironment,
        DEV_AUTH_SUBJECT: "another-local-credit-owner",
      },
    );
    const deniedBody: unknown = await denied.json();

    expect(response.status).toBe(200);
    expect(envelope.error).toBeNull();
    expect(envelope.data).toMatchObject({
      availableCredits: 20,
      reservedCredits: 0,
      settledCredits: 0,
    });
    expect(denied.status).toBe(403);
    expect(deniedBody).toMatchObject({
      data: null,
      error: { code: "ENTITLEMENT_REQUIRED", retryable: false },
    });
    expect(JSON.stringify(deniedBody)).not.toContain("availableCredits");
  });
});
