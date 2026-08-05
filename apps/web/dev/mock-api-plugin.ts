import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type MockScenario = "failed" | "malformed" | "success";
type MockPresetId = "lofi-study" | "music-box" | "soft-piano";
type MockCreateJobRequest = {
  presetId: MockPresetId;
  presetVersion: number;
  uploadId: string;
};
type MockOutput = {
  candidateIndex: 0 | 1;
  contentType: "audio/wav" | null;
  createdAt: string;
  durationSeconds: number | null;
  expiresAt: string;
  outputId: string;
  sizeBytes: number | null;
  status: "failed" | "pending" | "ready";
};
type MockPublicJob = {
  candidateCount: 2;
  completedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  expiresAt: string;
  jobId: string;
  outputs: MockOutput[];
  preset: { id: MockPresetId; version: number };
  retryPermitted: boolean;
  status: "completed" | "created" | "failed" | "generating";
  updatedAt: string;
  uploadId: string;
};

const mockLegalVersion = "2026-08-05";
const currentLegalAcceptanceDocuments = [
  { documentId: "terms-of-use", version: mockLegalVersion },
  { documentId: "acceptable-use", version: mockLegalVersion },
  { documentId: "ai-output-notice", version: mockLegalVersion },
] as const;

type StoredJob = {
  job: MockPublicJob;
  polls: number;
  scenario: MockScenario;
};

function resourceId(prefix: "job" | "out"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function requestId(): string {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.byteLength;
    if (size > 16_384) {
      throw new Error("Request body too large");
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function scenarioFrom(request: IncomingMessage): MockScenario {
  const referer = request.headers.referer;
  const value =
    referer === undefined
      ? null
      : new URL(referer, "http://localhost").searchParams.get("mockScenario");
  if (value === "failed" || value === "malformed") {
    return value;
  }
  return "success";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreateJobRequest(value: unknown): MockCreateJobRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const presetId = value.presetId;
  const presetVersion = value.presetVersion;
  const uploadId = value.uploadId;
  if (
    (presetId !== "soft-piano" && presetId !== "music-box" && presetId !== "lofi-study") ||
    typeof presetVersion !== "number" ||
    !Number.isInteger(presetVersion) ||
    presetVersion < 1 ||
    typeof uploadId !== "string" ||
    !/^upl_[0-9a-f]{32}$/.test(uploadId)
  ) {
    return null;
  }
  return { presetId, presetVersion, uploadId };
}

function createMockJob(request: unknown, scenario: MockScenario): MockPublicJob | null {
  const parsed = parseCreateJobRequest(request);
  if (parsed === null) {
    return null;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  return {
    candidateCount: 2,
    completedAt: null,
    createdAt: now.toISOString(),
    errorCode: null,
    expiresAt,
    jobId: resourceId("job"),
    outputs: [
      {
        candidateIndex: 0,
        contentType: null,
        createdAt: now.toISOString(),
        durationSeconds: null,
        expiresAt,
        outputId: resourceId("out"),
        sizeBytes: null,
        status: "pending",
      },
      {
        candidateIndex: 1,
        contentType: null,
        createdAt: now.toISOString(),
        durationSeconds: null,
        expiresAt,
        outputId: resourceId("out"),
        sizeBytes: null,
        status: "pending",
      },
    ],
    preset: {
      id: parsed.presetId,
      version: parsed.presetVersion,
    },
    retryPermitted: scenario === "failed",
    status: "created",
    updatedAt: now.toISOString(),
    uploadId: parsed.uploadId,
  };
}

function advanceJob(stored: StoredJob): MockPublicJob {
  stored.polls += 1;
  const now = new Date().toISOString();
  if (stored.polls === 1) {
    stored.job = { ...stored.job, status: "generating", updatedAt: now };
    return stored.job;
  }
  if (stored.scenario === "failed") {
    stored.job = {
      ...stored.job,
      errorCode: "PROVIDER_UNAVAILABLE",
      outputs: stored.job.outputs.map((output) => ({ ...output, status: "failed" })),
      retryPermitted: true,
      status: "failed",
      updatedAt: now,
    };
    return stored.job;
  }
  stored.job = {
    ...stored.job,
    completedAt: now,
    outputs: stored.job.outputs.map((output) => ({
      ...output,
      contentType: "audio/wav",
      durationSeconds: 2,
      sizeBytes: 32_044,
      status: "ready",
    })),
    retryPermitted: false,
    status: "completed",
    updatedAt: now,
  };
  return stored.job;
}

function waveFile(candidateIndex: 0 | 1): Uint8Array {
  const sampleRate = 8_000;
  const sampleCount = sampleRate * 2;
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  const frequency = candidateIndex === 0 ? 261.63 : 329.63;
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 500, (sampleCount - index) / 500);
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.12 * fade;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }
  return bytes;
}

async function handleMockRequest(
  request: IncomingMessage,
  response: ServerResponse,
  jobs: Map<string, StoredJob>,
): Promise<boolean> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && /^\/__studymix-mock\/candidate-[01]\.wav$/.test(url.pathname)) {
    const candidateIndex = url.pathname.includes("candidate-0") ? 0 : 1;
    const body = waveFile(candidateIndex);
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Length", body.byteLength.toString());
    response.setHeader("Content-Type", "audio/wav");
    response.end(body);
    return true;
  }

  if (method === "GET" && url.pathname === "/api/session") {
    sendJson(response, 200, {
      data: {
        authorization: {
          accountStatus: "active",
          aiJobApprovalMode: "manual",
          membershipStatus: "active",
          paymentStatus: "disabled",
          permissions: [
            "workspace:read",
            "workspace:manage",
            "jobs:create",
            "jobs:read",
            "credits:read",
            "approvals:manage",
          ],
          realProviderStatus: "disabled",
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
        },
        kind: "development",
      },
      error: null,
      requestId: requestId(),
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/legal/documents.json") {
    sendJson(response, 200, {
      data: {
        contactEmail: "privacy@example.test",
        documents: [
          {
            documentId: "terms-of-use",
            path: "/legal/terms",
            requiresAcceptance: true,
            summary: { en: "Private beta terms.", "zh-HK": "封閉測試使用條款。" },
            title: { en: "Terms of Use", "zh-HK": "使用條款" },
            version: mockLegalVersion,
          },
          {
            documentId: "privacy-notice",
            path: "/legal/privacy",
            requiresAcceptance: false,
            summary: { en: "Private beta privacy notice.", "zh-HK": "封閉測試私隱通知。" },
            title: { en: "Privacy Notice", "zh-HK": "私隱通知" },
            version: mockLegalVersion,
          },
          {
            documentId: "acceptable-use",
            path: "/legal/acceptable-use",
            requiresAcceptance: true,
            summary: { en: "Private beta acceptable use.", "zh-HK": "封閉測試可接受使用政策。" },
            title: { en: "Acceptable Use", "zh-HK": "可接受使用政策" },
            version: mockLegalVersion,
          },
          {
            documentId: "ai-output-notice",
            path: "/legal/ai-output-notice",
            requiresAcceptance: true,
            summary: { en: "Private beta AI notice.", "zh-HK": "封閉測試 AI 聲明。" },
            title: { en: "AI and Output Notice", "zh-HK": "AI 及輸出聲明" },
            version: mockLegalVersion,
          },
        ],
        effectiveAt: "2026-08-05T00:00:00.000Z",
      },
      error: null,
      requestId: requestId(),
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/legal/acceptances") {
    const acceptedAt = new Date().toISOString();
    sendJson(response, 200, {
      data: {
        acceptedAt: {
          "acceptable-use": acceptedAt,
          "ai-output-notice": acceptedAt,
          "terms-of-use": acceptedAt,
        },
        current: true,
        requiredDocuments: currentLegalAcceptanceDocuments,
      },
      error: null,
      requestId: requestId(),
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/jobs") {
    let body: unknown;
    try {
      body = await readJson(request);
    } catch {
      sendJson(response, 400, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "The job request is invalid.",
          retryable: false,
        },
        requestId: requestId(),
      });
      return true;
    }
    const scenario = scenarioFrom(request);
    const job = createMockJob(body, scenario);
    if (job === null) {
      sendJson(response, 400, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "The job request is invalid.",
          retryable: false,
        },
        requestId: requestId(),
      });
      return true;
    }
    jobs.set(job.jobId, { job, polls: 0, scenario });
    sendJson(response, 202, { data: job, error: null, requestId: requestId() });
    return true;
  }

  const jobMatch = /^\/api\/jobs\/(job_[0-9a-f]{32})$/.exec(url.pathname);
  if (method === "GET" && jobMatch !== null) {
    const jobId = jobMatch[1];
    const stored = jobId === undefined ? undefined : jobs.get(jobId);
    if (stored === undefined) {
      sendJson(response, 404, {
        data: null,
        error: { code: "NOT_FOUND", message: "The job was not found.", retryable: false },
        requestId: requestId(),
      });
      return true;
    }
    if (stored.scenario === "malformed" && stored.polls > 0) {
      sendJson(response, 200, { data: { status: "not-a-real-status" } });
      return true;
    }
    sendJson(response, 200, { data: advanceJob(stored), error: null, requestId: requestId() });
    return true;
  }

  return false;
}

export function studymixMockApiPlugin(): Plugin {
  return {
    configureServer(server) {
      const jobs = new Map<string, StoredJob>();
      server.middlewares.use((request, response, next) => {
        void handleMockRequest(request, response, jobs)
          .then((handled) => {
            if (!handled) {
              next();
            }
          })
          .catch(next);
      });
    },
    name: "studymix-local-mock-api",
  };
}
