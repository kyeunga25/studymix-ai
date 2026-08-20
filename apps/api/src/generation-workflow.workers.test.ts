import {
  apiEnvelopeSchema,
  creditSummarySchema,
  createUploadResponseSchema,
  currentRightsDeclarationVersion,
  publicJobSchema,
} from "@studymix/contracts";
import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { createSecureId } from "@studymix/core";
import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "./index";
import {
  GenerationWorkflowConfigurationError,
  isMockGenerationAvailable,
  isRealGenerationRequestWithinRateLimit,
  isRealGenerationAvailable,
  resolveGenerationWorkflowConfiguration,
} from "./job-service";
import {
  getOwnedCreditReservationStatus,
  getOwnedCreditSummary,
  grantPrivateBetaCredits,
  recordCurrentLegalAcceptances,
} from "./repositories";
import { ensureFirstProviderSubmissionAttempt } from "./workflows/generation-workflow";
import { createSyntheticMp3Fixture } from "./test-audio-fixtures";

const uploadEnvelopeSchema = apiEnvelopeSchema(createUploadResponseSchema);
const jobEnvelopeSchema = apiEnvelopeSchema(publicJobSchema);
const creditEnvelopeSchema = apiEnvelopeSchema(creditSummarySchema);
const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string() }) });
const browserMutationHeaders = {
  [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
} as const;
const jsonBrowserMutationHeaders = {
  ...browserMutationHeaders,
  "Content-Type": "application/json",
} as const;
const syntheticMp3 = createSyntheticMp3Fixture();
const validJobRequestBody = {
  candidateCount: 2,
  idempotencyKey: "synthetic-job-request-0001",
  presetId: "soft-piano",
  presetVersion: 1,
  rightsDeclarationVersion: currentRightsDeclarationVersion,
  uploadId: `upl_${"1".repeat(32)}`,
} as const;
const invalidJobRequestCases = [
  {
    body: JSON.stringify(validJobRequestBody),
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
    body: JSON.stringify({ ...validJobRequestBody, unexpected: true }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an extra request field",
  },
  {
    body: JSON.stringify({ ...validJobRequestBody, candidateCount: 1 }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "an unsupported candidate count",
  },
  {
    body: JSON.stringify({ ...validJobRequestBody, rightsDeclarationVersion: "v2" }),
    contentType: "application/json",
    expectedStatus: 400,
    label: "a non-current rights declaration version",
  },
] satisfies readonly Readonly<{
  body: string;
  contentType: string;
  expectedStatus: 400 | 413 | 415;
  label: string;
}>[];

async function resetDatabase(): Promise<void> {
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

async function createConfirmedUpload(withLegalAcceptance: boolean): Promise<string> {
  const uploadResponse = await app.request(
    "http://localhost:8787/api/uploads",
    {
      body: JSON.stringify({
        contentType: "audio/mpeg",
        idempotencyKey: "test-upload-workflow-fixture",
        originalFilename: "workflow-fixture.mp3",
        sizeBytes: syntheticMp3.byteLength,
      }),
      headers: jsonBrowserMutationHeaders,
      method: "POST",
    },
    env,
  );
  const uploadEnvelope = uploadEnvelopeSchema.parse(await uploadResponse.json());
  if (uploadEnvelope.error !== null) {
    throw new Error("Test upload could not be created.");
  }
  await env.AUDIO_BUCKET.put(uploadEnvelope.data.objectKey, syntheticMp3, {
    httpMetadata: { contentType: "audio/mpeg" },
  });
  const confirmResponse = await app.request(
    `http://localhost:8787/api/uploads/${uploadEnvelope.data.uploadId}/confirm`,
    { headers: browserMutationHeaders, method: "POST" },
    env,
  );
  expect(confirmResponse.status).toBe(200);

  const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
  if (owner === null) {
    throw new Error("Test owner was not created.");
  }
  await grantPrivateBetaCredits(env.DB, {
    createdAt: new Date().toISOString(),
    eventId: createSecureId("evt"),
    ownerId: owner.id,
    quantity: 20,
    referenceKey: `test:workflow-grant:${owner.id}`,
  });
  if (withLegalAcceptance) {
    await recordCurrentLegalAcceptances(env.DB, owner.id, new Date().toISOString());
  }
  return uploadEnvelope.data.uploadId;
}

function jobRequest(uploadId: string): RequestInit {
  return {
    body: JSON.stringify({
      candidateCount: 2,
      idempotencyKey: "workflow-test-request-0001",
      presetId: "soft-piano",
      presetVersion: 1,
      rightsDeclarationVersion: currentRightsDeclarationVersion,
      uploadId,
    }),
    headers: jsonBrowserMutationHeaders,
    method: "POST",
  };
}

describe("feature-gated mock generation Workflow", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each(invalidJobRequestCases)(
    "rejects $label before creating generation side effects",
    async ({ body, contentType, expectedStatus }) => {
      const response = await app.request(
        "http://localhost:8787/api/jobs",
        {
          body,
          headers: { ...browserMutationHeaders, "Content-Type": contentType },
          method: "POST",
        },
        env,
      );
      const responseBody: unknown = await response.json();
      const sideEffects = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM jobs) AS jobs,
          (SELECT COUNT(*) FROM outputs) AS outputs,
          (SELECT COUNT(*) FROM provider_requests) AS provider_requests,
          (SELECT COUNT(*) FROM rights_declarations) AS rights_declarations,
          (SELECT COUNT(*) FROM usage_events) AS usage_events`,
      ).first<{
        jobs: number;
        outputs: number;
        provider_requests: number;
        rights_declarations: number;
        usage_events: number;
      }>();

      expect(response.status).toBe(expectedStatus);
      expect(responseBody).toMatchObject({
        data: null,
        error: { code: "VALIDATION_ERROR", retryable: false },
      });
      expect(JSON.stringify(responseBody)).not.toContain("synthetic-job-request");
      expect(sideEffects).toEqual({
        jobs: 0,
        outputs: 0,
        provider_requests: 0,
        rights_declarations: 0,
        usage_events: 0,
      });
    },
  );

  it("creates two private mock outputs and keeps retries and reads owner-scoped", async () => {
    const uploadId = await createConfirmedUpload(true);
    const creditResponse = await app.request(
      "http://localhost:8787/api/credits",
      { headers: browserMutationHeaders },
      env,
    );
    const creditEnvelope = creditEnvelopeSchema.parse(await creditResponse.json());
    expect(creditResponse.status).toBe(200);
    expect(creditEnvelope.error).toBeNull();
    if (creditEnvelope.error === null) {
      expect(creditEnvelope.data).toMatchObject({ availableCredits: 20, reservedCredits: 0 });
    }
    const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
    try {
      await introspector.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "store candidate 0" },
          new Error("Synthetic retry test failure."),
          1,
        );
      });
      const createResponse = await app.request(
        "http://localhost:8787/api/jobs",
        jobRequest(uploadId),
        env,
      );
      const createEnvelope = jobEnvelopeSchema.parse(await createResponse.json());
      expect(createResponse.status).toBe(202);
      expect(createEnvelope.error).toBeNull();
      if (createEnvelope.error !== null) {
        throw new Error("Test job could not be created.");
      }

      const instances = await introspector.get();
      expect(instances).toHaveLength(1);
      const instance = instances[0];
      if (instance === undefined) {
        throw new Error("Test Workflow instance was not created.");
      }
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        jobId: createEnvelope.data.jobId,
        status: "completed",
      });

      const jobResponse = await app.request(
        `http://localhost:8787/api/jobs/${createEnvelope.data.jobId}`,
        { headers: browserMutationHeaders },
        env,
      );
      const completedEnvelope = jobEnvelopeSchema.parse(await jobResponse.json());
      expect(jobResponse.status).toBe(200);
      expect(completedEnvelope.error).toBeNull();
      if (completedEnvelope.error !== null) {
        throw new Error("Completed test job could not be read.");
      }
      expect(completedEnvelope.data.status).toBe("completed");
      expect(completedEnvelope.data.outputs).toHaveLength(2);
      expect(completedEnvelope.data.outputs.map((output) => output.candidateIndex)).toEqual([0, 1]);
      expect(
        completedEnvelope.data.outputs.every(
          (output) =>
            output.status === "ready" &&
            output.contentType === "audio/wav" &&
            output.sizeBytes === 16_044 &&
            output.durationSeconds === 1,
        ),
      ).toBe(true);

      const outputRows = await env.DB.prepare(
        "SELECT object_key FROM outputs ORDER BY candidate_index",
      ).all<{ object_key: string }>();
      for (const outputRow of outputRows.results) {
        const object = await env.AUDIO_BUCKET.head(outputRow.object_key);
        expect(object?.size).toBe(16_044);
        expect(object?.httpMetadata?.contentType).toBe("audio/wav");
      }
      const metadataCounts = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM provider_requests) AS provider_requests,
          (SELECT COUNT(*) FROM rights_declarations) AS rights_declarations,
          (SELECT COUNT(*) FROM usage_events) AS usage_events`,
      ).first<{
        provider_requests: number;
        rights_declarations: number;
        usage_events: number;
      }>();
      expect(metadataCounts).toEqual({
        provider_requests: 2,
        rights_declarations: 1,
        usage_events: 1,
      });
      const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
      if (owner === null) {
        throw new Error("Test owner was not created.");
      }
      expect(
        await getOwnedCreditReservationStatus(env.DB, owner.id, createEnvelope.data.jobId),
      ).toBe("settled");
      expect(await getOwnedCreditSummary(env.DB, owner.id)).toMatchObject({
        availableCredits: 18,
        reservedCredits: 0,
        settledCredits: 2,
      });

      const repeatedResponse = await app.request(
        "http://localhost:8787/api/jobs",
        jobRequest(uploadId),
        env,
      );
      const repeatedEnvelope = jobEnvelopeSchema.parse(await repeatedResponse.json());
      expect(repeatedResponse.status).toBe(202);
      expect(repeatedEnvelope.error).toBeNull();
      if (repeatedEnvelope.error === null) {
        expect(repeatedEnvelope.data.jobId).toBe(createEnvelope.data.jobId);
      }
      expect(await introspector.get()).toHaveLength(1);

      const denied = await app.request(
        `http://localhost:8787/api/jobs/${createEnvelope.data.jobId}`,
        { headers: browserMutationHeaders },
        { ...env, DEV_AUTH_SUBJECT: "another-test-owner" },
      );
      expect(denied.status).toBe(404);
      expect(errorEnvelopeSchema.parse(await denied.json()).error.code).toBe("NOT_FOUND");
    } finally {
      await introspector.dispose();
    }
  });

  it("releases reserved credits when the Workflow reaches a terminal failure", async () => {
    const uploadId = await createConfirmedUpload(true);
    const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
    try {
      await introspector.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "store candidate 0" },
          new Error("Synthetic terminal failure."),
          4,
        );
      });
      const createResponse = await app.request(
        "http://localhost:8787/api/jobs",
        jobRequest(uploadId),
        env,
      );
      const createEnvelope = jobEnvelopeSchema.parse(await createResponse.json());
      expect(createResponse.status).toBe(202);
      expect(createEnvelope.error).toBeNull();
      if (createEnvelope.error !== null) {
        throw new Error("Test job could not be created.");
      }

      const instances = await introspector.get();
      const instance = instances[0];
      if (instance === undefined) {
        throw new Error("Test Workflow instance was not created.");
      }
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        jobId: createEnvelope.data.jobId,
        status: "failed",
      });

      const owner = await env.DB.prepare("SELECT id FROM owners LIMIT 1").first<{ id: string }>();
      if (owner === null) {
        throw new Error("Test owner was not created.");
      }
      expect(
        await getOwnedCreditReservationStatus(env.DB, owner.id, createEnvelope.data.jobId),
      ).toBe("released");
      expect(await getOwnedCreditSummary(env.DB, owner.id)).toMatchObject({
        availableCredits: 20,
        reservedCredits: 0,
        settledCredits: 0,
      });

      const jobResponse = await app.request(
        `http://localhost:8787/api/jobs/${createEnvelope.data.jobId}`,
        { headers: browserMutationHeaders },
        env,
      );
      const failedEnvelope = jobEnvelopeSchema.parse(await jobResponse.json());
      expect(jobResponse.status).toBe(200);
      expect(failedEnvelope.error).toBeNull();
      if (failedEnvelope.error === null) {
        expect(failedEnvelope.data.status).toBe("failed");
      }
    } finally {
      await introspector.dispose();
    }
  });

  it("requires current legal acceptance before creating metadata or a Workflow", async () => {
    const uploadId = await createConfirmedUpload(false);
    const introspector = await introspectWorkflow(env.GENERATION_WORKFLOW);
    try {
      const response = await app.request(
        "http://localhost:8787/api/jobs",
        jobRequest(uploadId),
        env,
      );
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM jobs").first<{
        total: number;
      }>();

      expect(response.status).toBe(409);
      expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe(
        "LEGAL_ACCEPTANCE_REQUIRED",
      );
      expect(count?.total).toBe(0);
      expect(await introspector.get()).toHaveLength(0);
    } finally {
      await introspector.dispose();
    }
  });

  it("fails closed while the Workflow feature flag is disabled", async () => {
    const response = await app.request(
      "http://localhost:8787/api/jobs",
      jobRequest("upl_11111111111111111111111111111111"),
      { ...env, JOB_WORKFLOW_ENABLED: "false" },
    );
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM jobs").first<{
      total: number;
    }>();

    expect(response.status).toBe(503);
    expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe(
      "PROVIDER_UNAVAILABLE",
    );
    expect(count?.total).toBe(0);
  });

  it("resolves valid fal configuration without making a provider request", () => {
    const falEnv: Env = {
      ...env,
      DOWNLOAD_URL_TTL_SECONDS: "900",
      FAL_KEY: "test-only-fal-credential-000001",
      GENERATION_PROVIDER: "fal",
      REAL_GENERATION_ENABLED: "true",
    };

    const configuration = resolveGenerationWorkflowConfiguration(falEnv);
    expect(configuration.provider).toBe("fal");
    if (configuration.provider !== "fal") {
      throw new TypeError("Expected fal configuration.");
    }
    expect(configuration.fal.webhookUrl).toBe("https://studymix.example/api/webhooks/fal");
    expect(configuration.fal.webhookUserId).toBe("test-fal-user");
    expect(isRealGenerationAvailable(falEnv)).toBe(true);
    expect(isMockGenerationAvailable(falEnv)).toBe(false);
  });

  it("uses hashed owner and IP keys for the coarse real-generation limiter", async () => {
    const observedKeys: string[] = [];
    const rateLimiter: RateLimit = {
      async limit({ key }) {
        observedKeys.push(key);
        return { success: true };
      },
    };
    const falEnv: Env = {
      ...env,
      DOWNLOAD_URL_TTL_SECONDS: "900",
      FAL_KEY: "test-only-fal-credential-000001",
      GENERATION_PROVIDER: "fal",
      JOB_RATE_LIMITER: rateLimiter,
      REAL_GENERATION_ENABLED: "true",
    };
    const configuration = resolveGenerationWorkflowConfiguration(falEnv);

    await expect(
      isRealGenerationRequestWithinRateLimit(
        configuration,
        "own_11111111111111111111111111111111",
        "203.0.113.10",
      ),
    ).resolves.toBe(true);
    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[0]).toBe("owner:own_11111111111111111111111111111111");
    expect(observedKeys[1]).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(observedKeys.join(" ")).not.toContain("203.0.113.10");
  });

  it("rejects real generation when the coarse limiter denies a request", async () => {
    const uploadId = await createConfirmedUpload(true);
    await env.DB.prepare("UPDATE workspace_controls SET real_provider_status = 'approved'").run();
    const deniedEnvironment: Env = {
      ...env,
      DOWNLOAD_URL_TTL_SECONDS: "900",
      FAL_KEY: "test-only-fal-credential-000001",
      GENERATION_PROVIDER: "fal",
      JOB_RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      },
      REAL_GENERATION_ENABLED: "true",
    };
    const baseRequest = jobRequest(uploadId);
    const response = await app.request(
      "http://localhost:8787/api/jobs",
      {
        ...baseRequest,
        headers: {
          ...baseRequest.headers,
          "CF-Connecting-IP": "203.0.113.10",
        },
      },
      deniedEnvironment,
    );
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM jobs").first<{
      total: number;
    }>();

    expect(response.status).toBe(429);
    expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe("RATE_LIMITED");
    expect(count?.total).toBe(0);
  });

  it("fails closed for a placeholder fal credential", () => {
    const falEnv: Env = {
      ...env,
      DOWNLOAD_URL_TTL_SECONDS: "900",
      GENERATION_PROVIDER: "fal",
      REAL_GENERATION_ENABLED: "true",
    };

    expect(() => resolveGenerationWorkflowConfiguration(falEnv)).toThrow(
      GenerationWorkflowConfigurationError,
    );
    expect(isRealGenerationAvailable(falEnv)).toBe(false);
  });

  it("fails closed when the signed webhook identity is not configured", () => {
    const falEnv: Env = {
      ...env,
      DOWNLOAD_URL_TTL_SECONDS: "900",
      FAL_KEY: "test-only-fal-credential-000001",
      FAL_WEBHOOK_URL: "https://webhook.invalid/api/webhooks/fal",
      FAL_WEBHOOK_USER_ID: "CHANGE_ME_FAL_WEBHOOK_USER_ID",
      GENERATION_PROVIDER: "fal",
      REAL_GENERATION_ENABLED: "true",
    };

    expect(() => resolveGenerationWorkflowConfiguration(falEnv)).toThrow(
      GenerationWorkflowConfigurationError,
    );
    expect(isRealGenerationAvailable(falEnv)).toBe(false);
  });

  it("blocks duplicate provider submission attempts", () => {
    expect(() => ensureFirstProviderSubmissionAttempt(1)).not.toThrow();
    expect(() => ensureFirstProviderSubmissionAttempt(2)).toThrow(
      "a duplicate request was not sent",
    );
  });
});
