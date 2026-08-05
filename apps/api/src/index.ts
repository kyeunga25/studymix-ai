import {
  acceptLegalDocumentsRequestSchema,
  audioContentTypeSchema,
  audioContentTypes,
  createJobRequestSchema,
  createLocalSyntheticUploadRequestSchema,
  createUploadRequestSchema,
  currentLegalAcceptanceDocuments,
  jobIdSchema,
  outputIdSchema,
  publicPresetsSchema,
  uploadIdSchema,
  type ApiErrorCode,
  type PublicUpload,
} from "@studymix/contracts";
import { createSecureId } from "@studymix/core";
import { listPresets, resolvePreset, toPublicPreset } from "@studymix/presets";
import { Hono, type Context } from "hono";
import { AuthenticationError, resolveOwnerContext, type OwnerContext } from "./auth/owner-context";
import { handleFalWebhook } from "./fal-webhook";
import {
  GenerationWorkflowConfigurationError,
  GenerationWorkflowDisabledError,
  createJobRequestFingerprint,
  ensureWorkflowStarted,
  getOwnedPublicJob,
  isCreditAccountingAvailable,
  isMockGenerationAvailable,
  isRealGenerationAvailable,
  isRealGenerationRequestWithinRateLimit,
  resolveGenerationWorkflowConfiguration,
} from "./job-service";
import {
  buildLocalAiJobPolicy,
  cancelLocalAiAttempts,
  createLocalSyntheticSource,
  getLocalAiJobPolicy,
  isLocalAiHarnessRequest,
} from "./local-ai";
import { LegalConfigurationError, resolveLegalDocumentsManifest } from "./legal-documents";
import {
  RepositoryConflictError,
  RepositoryCreditsInsufficientError,
  RepositoryEntitlementRequiredError,
  RepositoryLegalAcceptanceRequiredError,
  RepositoryNotFoundError,
  RepositoryQuotaError,
  RepositoryStateError,
  attachOwnedJobWorkflow,
  cancelOwnedJobWithCreditRelease,
  confirmOwnedUpload,
  createJobIdempotently,
  createUpload,
  expireOwnedUpload,
  getCurrentLegalAcceptanceStatus,
  getOwnedCreditSummary,
  getOwnedOutput,
  getOwnedUpload,
  markOwnedUploadDeleted,
  recordCurrentLegalAcceptances,
  upsertOwner,
} from "./repositories";
import type { UploadRecord } from "./repositories/upload-repository";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  UnsupportedJsonMediaTypeError,
  readBoundedJson,
} from "./request-json";
import {
  R2TransferConfigurationError,
  R2TransferDisabledError,
  createSignedR2ObjectUrl,
  isR2TransferAvailable,
  resolveMaxUploadBytes,
  resolveR2TransferConfiguration,
} from "./r2-transfer";
import {
  RetentionCleanupConfigurationError,
  isRetentionCleanupAvailable,
  purgeOwnedTerminalJob,
  resolveAbandonedUploadRetentionHours,
  runRetentionCleanup,
} from "./retention";

export { GenerationWorkflow } from "./workflows/generation-workflow";

type AppBindings = {
  Bindings: Env;
  Variables: {
    owner: OwnerContext;
  };
};

const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function contentSecurityPolicy(env: Env, includePrivateR2Origin: boolean): string {
  const r2Origin =
    includePrivateR2Origin && isR2TransferAvailable(env)
      ? ` https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : "";
  return `default-src 'self'; base-uri 'none'; connect-src 'self'${r2Origin}; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self' blob:${r2Origin}; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

function errorResponse(
  context: Context<AppBindings>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
  code: ApiErrorCode,
  message: string,
  retryable: boolean,
): Response {
  return context.json(
    {
      data: null,
      error: { code, message, retryable },
      requestId: createRequestId(),
    },
    status,
  );
}

function toPublicUpload(record: UploadRecord): PublicUpload {
  if (record.sizeBytes === null) {
    throw new TypeError("Upload size is unavailable.");
  }
  return {
    confirmedAt: record.confirmedAt,
    createdAt: record.createdAt,
    declaredContentType: audioContentTypeSchema.parse(record.declaredContentType),
    expiresAt: record.expiresAt,
    originalFilename: record.originalFilename,
    sizeBytes: record.sizeBytes,
    status: record.status === "pending" ? "uploading" : record.status,
    uploadId: uploadIdSchema.parse(record.id),
  };
}

function transferUnavailableResponse(
  context: Context<AppBindings>,
  error: R2TransferConfigurationError | R2TransferDisabledError,
): Response {
  return errorResponse(
    context,
    503,
    "INTERNAL_ERROR",
    error instanceof R2TransferDisabledError
      ? "Private audio transfer is not enabled."
      : "Private audio transfer is temporarily unavailable.",
    false,
  );
}

async function readUploadJson(context: Context<AppBindings>): Promise<unknown | Response> {
  try {
    return await readBoundedJson(context.req.raw, 4_096);
  } catch (error) {
    if (error instanceof UnsupportedJsonMediaTypeError) {
      return errorResponse(
        context,
        415,
        "VALIDATION_ERROR",
        "The request must use application/json.",
        false,
      );
    }
    if (error instanceof JsonBodyTooLargeError) {
      return errorResponse(
        context,
        413,
        "VALIDATION_ERROR",
        "The upload request is too large.",
        false,
      );
    }
    if (error instanceof InvalidJsonBodyError) {
      return errorResponse(
        context,
        400,
        "VALIDATION_ERROR",
        "The request body must be valid JSON.",
        false,
      );
    }
    throw error;
  }
}

async function readJobJson(context: Context<AppBindings>): Promise<unknown | Response> {
  try {
    return await readBoundedJson(context.req.raw, 4_096);
  } catch (error) {
    if (error instanceof UnsupportedJsonMediaTypeError) {
      return errorResponse(
        context,
        415,
        "VALIDATION_ERROR",
        "The request must use application/json.",
        false,
      );
    }
    if (error instanceof JsonBodyTooLargeError) {
      return errorResponse(
        context,
        413,
        "VALIDATION_ERROR",
        "The job request is too large.",
        false,
      );
    }
    if (error instanceof InvalidJsonBodyError) {
      return errorResponse(
        context,
        400,
        "VALIDATION_ERROR",
        "The request body must be valid JSON.",
        false,
      );
    }
    throw error;
  }
}

export const app = new Hono<AppBindings>();

app.use("*", async (context, next) => {
  await next();
  const path = context.req.path;
  const isSuccessfulPrivateAppResponse =
    (path === "/app" || path.startsWith("/app/")) && context.res.status < 400;
  context.header(
    "Content-Security-Policy",
    contentSecurityPolicy(context.env, isSuccessfulPrivateAppResponse),
  );
  for (const [name, value] of Object.entries(securityHeaders)) {
    context.header(name, value);
  }
  context.header("Cache-Control", "private, no-store");
  return;
});

const requireAuthentication = async (
  context: Context<AppBindings>,
  next: () => Promise<void>,
): Promise<Response | undefined> => {
  try {
    const owner = await resolveOwnerContext(context.req.raw, context.env);
    context.set("owner", owner);
    await next();
    return;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      const configurationFailure = error.reason === "AUTH_CONFIGURATION_INVALID";
      return errorResponse(
        context,
        error.status,
        configurationFailure ? "INTERNAL_ERROR" : "UNAUTHORIZED",
        configurationFailure
          ? "Authentication is temporarily unavailable."
          : "Sign-in is required to access StudyMix AI.",
        configurationFailure,
      );
    }
    throw error;
  }
};

const healthHandler = (context: Context<AppBindings>) =>
  context.json({
    data: {
      service: "studymix-api",
      status: "ok",
    },
    error: null,
    requestId: createRequestId(),
  });

const legalDocumentsHandler = (context: Context<AppBindings>) => {
  try {
    const documents = resolveLegalDocumentsManifest(context.env);
    return context.json({
      data: documents,
      error: null,
      requestId: createRequestId(),
    });
  } catch (error) {
    if (error instanceof LegalConfigurationError) {
      return errorResponse(
        context,
        503,
        "INTERNAL_ERROR",
        "Legal information is not configured. Service activation is blocked.",
        false,
      );
    }
    throw error;
  }
};

app.get("/health", healthHandler);
app.get("/legal/documents.json", legalDocumentsHandler);
app.post(
  "/api/webhooks/fal",
  async (context) => await handleFalWebhook(context.req.raw, context.env),
);

app.use("/app", requireAuthentication);
app.use("/app/*", requireAuthentication);
app.use("/api/*", requireAuthentication);

app.use("/api/*", async (context, next) => {
  const owner = context.get("owner");
  const record = await upsertOwner(context.env.DB, owner, new Date().toISOString());
  if (record.id !== owner.ownerId || record.status !== "active") {
    return errorResponse(
      context,
      403,
      "FORBIDDEN",
      "This account is not permitted to use StudyMix AI.",
      false,
    );
  }
  await next();
  return;
});

app.get("/api/health", healthHandler);
app.get("/api/legal/documents", legalDocumentsHandler);

app.get("/api/auth/me", (context) => {
  const owner = context.get("owner");
  return context.json({
    data: {
      capabilities: {
        creditAccounting: isCreditAccountingAvailable(context.env),
        localAiHarness: isLocalAiHarnessRequest(context.req.raw, context.env),
        mockGeneration: isMockGenerationAvailable(context.env),
        privateAudioUpload: isR2TransferAvailable(context.env),
        realGeneration: isRealGenerationAvailable(context.env),
        retentionCleanup: isRetentionCleanupAvailable(context.env),
      },
      kind: owner.kind,
      ownerId: owner.ownerId,
    },
    error: null,
    requestId: createRequestId(),
  });
});

app.get("/api/presets", (context) =>
  context.json({
    data: publicPresetsSchema.parse(listPresets().map(toPublicPreset)),
    error: null,
    requestId: createRequestId(),
  }),
);

app.get("/api/credits", async (context) => {
  if (!isCreditAccountingAvailable(context.env)) {
    return errorResponse(
      context,
      503,
      "INTERNAL_ERROR",
      "Private beta credit accounting is not enabled.",
      false,
    );
  }
  const owner = context.get("owner");
  const summary = await getOwnedCreditSummary(context.env.DB, owner.ownerId);
  if (summary === null || summary.status !== "active") {
    return errorResponse(
      context,
      403,
      "ENTITLEMENT_REQUIRED",
      "An active private beta entitlement is required.",
      false,
    );
  }
  return context.json({ data: summary, error: null, requestId: createRequestId() });
});

app.get("/api/legal/acceptances", async (context) => {
  try {
    resolveLegalDocumentsManifest(context.env);
  } catch (error) {
    if (error instanceof LegalConfigurationError) {
      return errorResponse(
        context,
        503,
        "INTERNAL_ERROR",
        "Legal information is not configured. Service activation is blocked.",
        false,
      );
    }
    throw error;
  }

  const owner = context.get("owner");
  const status = await getCurrentLegalAcceptanceStatus(context.env.DB, owner.ownerId);
  return context.json({ data: status, error: null, requestId: createRequestId() });
});

app.post("/api/legal/acceptances", async (context) => {
  try {
    resolveLegalDocumentsManifest(context.env);
  } catch (error) {
    if (error instanceof LegalConfigurationError) {
      return errorResponse(
        context,
        503,
        "INTERNAL_ERROR",
        "Legal information is not configured. Service activation is blocked.",
        false,
      );
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await readBoundedJson(context.req.raw, 4_096);
  } catch (error) {
    if (error instanceof UnsupportedJsonMediaTypeError) {
      return errorResponse(
        context,
        415,
        "VALIDATION_ERROR",
        "The request must use application/json.",
        false,
      );
    }
    if (error instanceof JsonBodyTooLargeError) {
      return errorResponse(
        context,
        413,
        "VALIDATION_ERROR",
        "The legal acceptance request is too large.",
        false,
      );
    }
    if (error instanceof InvalidJsonBodyError) {
      return errorResponse(
        context,
        400,
        "VALIDATION_ERROR",
        "The request body must be valid JSON.",
        false,
      );
    }
    throw error;
  }

  const parsed = acceptLegalDocumentsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      context,
      400,
      "VALIDATION_ERROR",
      "Every required legal document must be accepted exactly once.",
      false,
    );
  }

  const versionsAreCurrent = currentLegalAcceptanceDocuments.every((currentDocument) =>
    parsed.data.documents.some(
      (acceptedDocument) =>
        acceptedDocument.documentId === currentDocument.documentId &&
        acceptedDocument.version === currentDocument.version,
    ),
  );
  if (!versionsAreCurrent) {
    return errorResponse(
      context,
      409,
      "LEGAL_DOCUMENT_VERSION_MISMATCH",
      "The legal documents changed. Review and accept the current versions.",
      false,
    );
  }

  const owner = context.get("owner");
  const status = await recordCurrentLegalAcceptances(
    context.env.DB,
    owner.ownerId,
    new Date().toISOString(),
  );
  return context.json({ data: status, error: null, requestId: createRequestId() });
});

app.post("/api/local/synthetic-upload", async (context) => {
  if (!isLocalAiHarnessRequest(context.req.raw, context.env)) {
    return errorResponse(context, 404, "NOT_FOUND", "The local test harness was not found.", false);
  }
  let body: unknown;
  try {
    body = await readBoundedJson(context.req.raw, 4_096);
  } catch (error) {
    if (error instanceof UnsupportedJsonMediaTypeError) {
      return errorResponse(
        context,
        415,
        "VALIDATION_ERROR",
        "The request must use application/json.",
        false,
      );
    }
    if (error instanceof JsonBodyTooLargeError) {
      return errorResponse(
        context,
        413,
        "VALIDATION_ERROR",
        "The local fixture request is too large.",
        false,
      );
    }
    if (error instanceof InvalidJsonBodyError) {
      return errorResponse(
        context,
        400,
        "VALIDATION_ERROR",
        "The request body must be valid JSON.",
        false,
      );
    }
    throw error;
  }
  const parsed = createLocalSyntheticUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      context,
      400,
      "VALIDATION_ERROR",
      "The local synthetic fixture request is invalid.",
      false,
    );
  }
  const owner = context.get("owner");
  try {
    const upload = await createLocalSyntheticSource(
      context.env,
      owner.ownerId,
      parsed.data,
      new Date(),
    );
    return context.json({
      data: toPublicUpload(upload),
      error: null,
      requestId: createRequestId(),
    });
  } catch (error) {
    if (error instanceof RepositoryQuotaError) {
      return errorResponse(
        context,
        429,
        "RATE_LIMITED",
        "Delete or use an active synthetic source before creating another.",
        true,
      );
    }
    if (error instanceof TypeError) {
      return errorResponse(
        context,
        400,
        "VALIDATION_ERROR",
        "The local synthetic source failed validation.",
        false,
      );
    }
    throw error;
  }
});

app.post("/api/uploads", async (context) => {
  let configuration;
  try {
    configuration = resolveR2TransferConfiguration(context.env);
  } catch (error) {
    if (error instanceof R2TransferConfigurationError || error instanceof R2TransferDisabledError) {
      return transferUnavailableResponse(context, error);
    }
    throw error;
  }

  const body = await readUploadJson(context);
  if (body instanceof Response) {
    return body;
  }
  const parsed = createUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      context,
      400,
      "VALIDATION_ERROR",
      "The upload metadata is invalid.",
      false,
    );
  }
  if (parsed.data.sizeBytes > configuration.maxUploadBytes) {
    return errorResponse(
      context,
      413,
      "VALIDATION_ERROR",
      "The selected audio file exceeds the upload limit.",
      false,
    );
  }

  const owner = context.get("owner");
  const now = new Date();
  const uploadId = createSecureId("upl");
  const objectKey = `owners/${owner.ownerId}/uploads/${uploadId}/source`;
  const signedUpload = await createSignedR2ObjectUrl({
    configuration,
    contentType: parsed.data.contentType,
    method: "PUT",
    now,
    objectKey,
  });
  try {
    await createUpload(context.env.DB, {
      createdAt: now.toISOString(),
      declaredContentType: parsed.data.contentType,
      expiresAt: signedUpload.expiresAt,
      id: uploadId,
      maxActiveUploads: configuration.maxActiveUploads,
      objectKey,
      originalFilename: parsed.data.originalFilename,
      ownerId: owner.ownerId,
      sizeBytes: parsed.data.sizeBytes,
    });
  } catch (error) {
    if (error instanceof RepositoryQuotaError) {
      return errorResponse(
        context,
        429,
        "RATE_LIMITED",
        "Delete or use an active upload before creating another.",
        true,
      );
    }
    throw error;
  }

  return context.json(
    {
      data: {
        allowedContentTypes: audioContentTypes,
        expiresAt: signedUpload.expiresAt,
        maxUploadBytes: configuration.maxUploadBytes,
        objectKey,
        requiredHeaders: {
          "Content-Type": parsed.data.contentType,
          "If-None-Match": "*" as const,
        },
        uploadId,
        uploadMethod: "PUT" as const,
        uploadUrl: signedUpload.url,
      },
      error: null,
      requestId: createRequestId(),
    },
    201,
  );
});

app.post("/api/uploads/:uploadId/confirm", async (context) => {
  const parsedUploadId = uploadIdSchema.safeParse(context.req.param("uploadId"));
  if (!parsedUploadId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The upload was not found.", false);
  }

  const owner = context.get("owner");
  const upload = await getOwnedUpload(context.env.DB, owner.ownerId, parsedUploadId.data);
  if (upload === null || upload.status === "deleted") {
    return errorResponse(context, 404, "NOT_FOUND", "The upload was not found.", false);
  }
  if (upload.status === "confirmed") {
    return context.json({
      data: toPublicUpload(upload),
      error: null,
      requestId: createRequestId(),
    });
  }

  const now = new Date();
  if (upload.status === "expired" || new Date(upload.expiresAt).getTime() <= now.getTime()) {
    await context.env.AUDIO_BUCKET.delete(upload.objectKey);
    if (upload.status === "pending") {
      await expireOwnedUpload(context.env.DB, owner.ownerId, upload.id, now.toISOString());
    }
    return errorResponse(context, 409, "UPLOAD_EXPIRED", "The upload has expired.", false);
  }

  const object = await context.env.AUDIO_BUCKET.head(upload.objectKey);
  if (object === null) {
    return errorResponse(
      context,
      409,
      "UPLOAD_NOT_CONFIRMED",
      "The audio object is not available yet.",
      true,
    );
  }

  const contentType = object.httpMetadata?.contentType;
  let maxUploadBytes: number;
  try {
    maxUploadBytes = resolveMaxUploadBytes(context.env);
  } catch (error) {
    if (error instanceof R2TransferConfigurationError) {
      return transferUnavailableResponse(context, error);
    }
    throw error;
  }
  const invalidObject =
    object.size <= 0 ||
    object.size > maxUploadBytes ||
    object.size !== upload.sizeBytes ||
    contentType !== upload.declaredContentType;
  if (invalidObject) {
    await markOwnedUploadDeleted(context.env.DB, owner.ownerId, upload.id);
    await context.env.AUDIO_BUCKET.delete(upload.objectKey);
    return errorResponse(
      context,
      400,
      "VALIDATION_ERROR",
      "The uploaded object does not match the declared audio metadata.",
      false,
    );
  }

  const confirmed = await confirmOwnedUpload(
    context.env.DB,
    owner.ownerId,
    upload.id,
    object.size,
    now.toISOString(),
    new Date(
      now.getTime() + resolveAbandonedUploadRetentionHours(context.env) * 60 * 60 * 1_000,
    ).toISOString(),
  );
  return context.json({
    data: toPublicUpload(confirmed),
    error: null,
    requestId: createRequestId(),
  });
});

app.delete("/api/uploads/:uploadId", async (context) => {
  const parsedUploadId = uploadIdSchema.safeParse(context.req.param("uploadId"));
  if (!parsedUploadId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The upload was not found.", false);
  }

  const owner = context.get("owner");
  try {
    const upload = await markOwnedUploadDeleted(context.env.DB, owner.ownerId, parsedUploadId.data);
    await context.env.AUDIO_BUCKET.delete(upload.objectKey);
  } catch (error) {
    if (error instanceof RepositoryNotFoundError) {
      return errorResponse(context, 404, "NOT_FOUND", "The upload was not found.", false);
    }
    if (error instanceof RepositoryConflictError) {
      return errorResponse(
        context,
        409,
        "CONFLICT",
        "An upload attached to a job cannot be deleted directly.",
        false,
      );
    }
    throw error;
  }

  return context.json({
    data: { status: "deleted" as const, uploadId: parsedUploadId.data },
    error: null,
    requestId: createRequestId(),
  });
});

app.post("/api/jobs", async (context) => {
  let configuration;
  try {
    configuration = resolveGenerationWorkflowConfiguration(context.env);
  } catch (error) {
    if (
      error instanceof GenerationWorkflowConfigurationError ||
      error instanceof GenerationWorkflowDisabledError
    ) {
      return errorResponse(
        context,
        503,
        "PROVIDER_UNAVAILABLE",
        "Private generation is not enabled.",
        false,
      );
    }
    throw error;
  }

  const body = await readJobJson(context);
  if (body instanceof Response) {
    return body;
  }
  const parsed = createJobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(context, 400, "VALIDATION_ERROR", "The job request is invalid.", false);
  }
  const preset = resolvePreset(parsed.data.presetId, parsed.data.presetVersion);
  if (preset === undefined) {
    return errorResponse(context, 404, "PRESET_NOT_FOUND", "The preset was not found.", false);
  }

  const owner = context.get("owner");
  if (
    !(await isRealGenerationRequestWithinRateLimit(
      configuration,
      owner.ownerId,
      context.req.header("CF-Connecting-IP"),
    ))
  ) {
    return errorResponse(
      context,
      429,
      "RATE_LIMITED",
      "Too many generation requests. Try again later.",
      true,
    );
  }
  const now = new Date();
  const requestedJobId = createSecureId("job");
  const idempotencyKey = parsed.data.idempotencyKey ?? `ui:${crypto.randomUUID()}`;
  const requestFingerprint = await createJobRequestFingerprint(parsed.data);
  let localOrchestrationPolicy;
  if (isLocalAiHarnessRequest(context.req.raw, context.env)) {
    try {
      localOrchestrationPolicy = await buildLocalAiJobPolicy(
        context.env.DB,
        owner.ownerId,
        parsed.data.uploadId,
        configuration.outputRetentionHours,
      );
    } catch {
      return errorResponse(
        context,
        400,
        "VALIDATION_ERROR",
        "A validated local synthetic source is required.",
        false,
      );
    }
  }
  let jobResult;
  try {
    jobResult = await createJobIdempotently(context.env.DB, {
      createdAt: now.toISOString(),
      creditCost: configuration.creditCost,
      dailyWindowStartedAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
      expiresAt: new Date(
        now.getTime() + configuration.outputRetentionHours * 60 * 60 * 1_000,
      ).toISOString(),
      id: requestedJobId,
      idempotencyKey,
      maxActiveJobs: configuration.maxActiveJobs,
      maxDailyJobs: configuration.maxDailyJobs,
      ...(localOrchestrationPolicy === undefined ? {} : { localOrchestrationPolicy }),
      ownerId: owner.ownerId,
      presetId: preset.id,
      presetVersion: preset.version,
      provider: configuration.provider,
      requestFingerprint,
      rightsDeclarationVersion: parsed.data.rightsDeclarationVersion,
      uploadId: parsed.data.uploadId,
    });
    await attachOwnedJobWorkflow(context.env.DB, owner.ownerId, jobResult.job.id, jobResult.job.id);
  } catch (error) {
    if (error instanceof RepositoryLegalAcceptanceRequiredError) {
      return errorResponse(
        context,
        409,
        "LEGAL_ACCEPTANCE_REQUIRED",
        "Accept the current legal documents before creating a job.",
        false,
      );
    }
    if (error instanceof RepositoryEntitlementRequiredError) {
      return errorResponse(
        context,
        403,
        "ENTITLEMENT_REQUIRED",
        "An active private beta entitlement is required.",
        false,
      );
    }
    if (error instanceof RepositoryCreditsInsufficientError) {
      return errorResponse(
        context,
        409,
        "INSUFFICIENT_CREDITS",
        "The private beta credit balance is insufficient.",
        false,
      );
    }
    if (error instanceof RepositoryNotFoundError) {
      return errorResponse(context, 404, "NOT_FOUND", "The confirmed upload was not found.", false);
    }
    if (error instanceof RepositoryQuotaError) {
      return errorResponse(
        context,
        429,
        "RATE_LIMITED",
        "The private generation quota has been reached. Try again later.",
        true,
      );
    }
    if (error instanceof RepositoryConflictError) {
      return errorResponse(
        context,
        409,
        "CONFLICT",
        "The idempotency key is already attached to a different request.",
        false,
      );
    }
    throw error;
  }

  try {
    await ensureWorkflowStarted(configuration.workflow, {
      jobId: jobResult.job.id,
      ownerId: owner.ownerId,
    });
  } catch {
    return errorResponse(
      context,
      503,
      "PROVIDER_UNAVAILABLE",
      "Private generation could not be started. Retry the same request.",
      true,
    );
  }

  const publicJob = await getOwnedPublicJob(context.env.DB, owner.ownerId, jobResult.job.id);
  if (publicJob === null) {
    throw new RepositoryNotFoundError("The created job could not be read.");
  }
  return context.json({ data: publicJob, error: null, requestId: createRequestId() }, 202);
});

app.get("/api/jobs/:jobId", async (context) => {
  const parsedJobId = jobIdSchema.safeParse(context.req.param("jobId"));
  if (!parsedJobId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
  }
  const owner = context.get("owner");
  const job = await getOwnedPublicJob(context.env.DB, owner.ownerId, parsedJobId.data);
  if (job === null) {
    return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
  }
  return context.json({ data: job, error: null, requestId: createRequestId() });
});

app.post("/api/jobs/:jobId/cancel", async (context) => {
  if (!isLocalAiHarnessRequest(context.req.raw, context.env)) {
    return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
  }
  const parsedJobId = jobIdSchema.safeParse(context.req.param("jobId"));
  if (!parsedJobId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
  }
  const owner = context.get("owner");
  if ((await getLocalAiJobPolicy(context.env.DB, owner.ownerId, parsedJobId.data)) === null) {
    return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
  }
  const cancelledAt = new Date().toISOString();
  try {
    await cancelOwnedJobWithCreditRelease(context.env.DB, {
      eventId: createSecureId("evt"),
      jobId: parsedJobId.data,
      ownerId: owner.ownerId,
      timestamp: cancelledAt,
    });
    await cancelLocalAiAttempts(context.env.DB, owner.ownerId, parsedJobId.data, cancelledAt);
  } catch (error) {
    if (error instanceof RepositoryNotFoundError) {
      return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
    }
    if (error instanceof RepositoryStateError) {
      return errorResponse(context, 409, "CONFLICT", "The job can no longer be cancelled.", false);
    }
    throw error;
  }
  const publicJob = await getOwnedPublicJob(context.env.DB, owner.ownerId, parsedJobId.data);
  if (publicJob === null) {
    throw new RepositoryNotFoundError("The cancelled job could not be read.");
  }
  return context.json({ data: publicJob, error: null, requestId: createRequestId() });
});

app.delete("/api/jobs/:jobId", async (context) => {
  const parsedJobId = jobIdSchema.safeParse(context.req.param("jobId"));
  if (!parsedJobId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
  }
  const owner = context.get("owner");
  try {
    await purgeOwnedTerminalJob(context.env, owner.ownerId, parsedJobId.data, new Date());
  } catch (error) {
    if (error instanceof RepositoryNotFoundError) {
      return errorResponse(context, 404, "NOT_FOUND", "The job was not found.", false);
    }
    if (error instanceof RepositoryStateError) {
      return errorResponse(
        context,
        409,
        "CONFLICT",
        "Only a completed, failed, cancelled, or expired job can be deleted.",
        false,
      );
    }
    if (error instanceof RetentionCleanupConfigurationError) {
      return errorResponse(
        context,
        503,
        "INTERNAL_ERROR",
        "Private deletion is not configured.",
        true,
      );
    }
    throw error;
  }
  return context.json({
    data: { jobId: parsedJobId.data, status: "deleted" as const },
    error: null,
    requestId: createRequestId(),
  });
});

app.post("/api/outputs/:outputId/download", async (context) => {
  const parsedOutputId = outputIdSchema.safeParse(context.req.param("outputId"));
  if (!parsedOutputId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The output was not found.", false);
  }

  let configuration;
  try {
    configuration = resolveR2TransferConfiguration(context.env);
  } catch (error) {
    if (error instanceof R2TransferConfigurationError || error instanceof R2TransferDisabledError) {
      return transferUnavailableResponse(context, error);
    }
    throw error;
  }

  const owner = context.get("owner");
  const output = await getOwnedOutput(context.env.DB, owner.ownerId, parsedOutputId.data);
  if (output === null) {
    return errorResponse(context, 404, "NOT_FOUND", "The output was not found.", false);
  }
  if (output.status !== "ready" || output.contentType === null || output.sizeBytes === null) {
    return errorResponse(context, 409, "OUTPUT_NOT_READY", "The output is not ready.", true);
  }
  const parsedOutputContentType = audioContentTypeSchema.safeParse(output.contentType);
  if (!parsedOutputContentType.success) {
    return errorResponse(
      context,
      503,
      "INTERNAL_ERROR",
      "The private output metadata is invalid.",
      false,
    );
  }

  const now = new Date();
  if (output.expiresAt === null || new Date(output.expiresAt).getTime() <= now.getTime()) {
    return errorResponse(context, 409, "OUTPUT_EXPIRED", "The output has expired.", false);
  }

  const object = await context.env.AUDIO_BUCKET.head(output.objectKey);
  if (
    object === null ||
    object.size !== output.sizeBytes ||
    object.httpMetadata?.contentType !== parsedOutputContentType.data
  ) {
    return errorResponse(
      context,
      503,
      "INTERNAL_ERROR",
      "The private output is temporarily unavailable.",
      true,
    );
  }

  if (isLocalAiHarnessRequest(context.req.raw, context.env)) {
    return context.json({
      data: {
        downloadMethod: "GET" as const,
        downloadUrl: `/api/local/outputs/${parsedOutputId.data}/content`,
        expiresAt: output.expiresAt,
        outputId: parsedOutputId.data,
      },
      error: null,
      requestId: createRequestId(),
    });
  }

  const signedDownload = await createSignedR2ObjectUrl({
    configuration,
    method: "GET",
    now,
    objectKey: output.objectKey,
  });
  return context.json({
    data: {
      downloadMethod: "GET" as const,
      downloadUrl: signedDownload.url,
      expiresAt: signedDownload.expiresAt,
      outputId: parsedOutputId.data,
    },
    error: null,
    requestId: createRequestId(),
  });
});

app.get("/api/local/outputs/:outputId/content", async (context) => {
  if (!isLocalAiHarnessRequest(context.req.raw, context.env)) {
    return errorResponse(context, 404, "NOT_FOUND", "The output was not found.", false);
  }
  const parsedOutputId = outputIdSchema.safeParse(context.req.param("outputId"));
  if (!parsedOutputId.success) {
    return errorResponse(context, 404, "NOT_FOUND", "The output was not found.", false);
  }
  const owner = context.get("owner");
  const output = await getOwnedOutput(context.env.DB, owner.ownerId, parsedOutputId.data);
  if (
    output === null ||
    output.status !== "ready" ||
    output.contentType !== "audio/wav" ||
    output.sizeBytes === null ||
    output.expiresAt === null ||
    new Date(output.expiresAt).getTime() <= Date.now()
  ) {
    return errorResponse(context, 404, "NOT_FOUND", "The output was not found.", false);
  }
  const object = await context.env.AUDIO_BUCKET.get(output.objectKey);
  if (
    object === null ||
    object.size !== output.sizeBytes ||
    object.httpMetadata?.contentType !== output.contentType
  ) {
    return errorResponse(
      context,
      503,
      "INTERNAL_ERROR",
      "The private output is temporarily unavailable.",
      true,
    );
  }
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="studymix-${parsedOutputId.data}.wav"`,
      "Content-Length": object.size.toString(),
      "Content-Type": output.contentType,
    },
  });
});

app.get("*", (context) => context.env.ASSETS.fetch(context.req.raw));

app.onError((error, context) => {
  const requestSurface = context.req.path.startsWith("/api/")
    ? "api"
    : context.req.path.startsWith("/app")
      ? "app"
      : "public";
  console.error(
    JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      event: "request_failed",
      requestSurface,
    }),
  );
  return errorResponse(context, 500, "INTERNAL_ERROR", "The request could not be completed.", true);
});

const worker = {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
  async scheduled(controller, env) {
    const result = await runRetentionCleanup(env, new Date(controller.scheduledTime));
    console.log(
      JSON.stringify({
        deletedJobs: result.deletedJobs,
        deletedObjects: result.deletedObjects,
        deletedSources: result.deletedSources,
        deletedUnattachedUploads: result.deletedUnattachedUploads,
        event: "retention_cleanup_completed",
        skipped: result.skipped,
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
