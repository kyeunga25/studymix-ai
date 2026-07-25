import {
  acceptLegalDocumentsRequestSchema,
  audioContentTypeSchema,
  audioContentTypes,
  createUploadRequestSchema,
  currentLegalAcceptanceDocuments,
  outputIdSchema,
  uploadIdSchema,
  type ApiErrorCode,
  type PublicUpload,
} from "@studymix/contracts";
import { createSecureId } from "@studymix/core";
import { Hono, type Context } from "hono";
import { AuthenticationError, resolveOwnerContext, type OwnerContext } from "./auth/owner-context";
import { LegalConfigurationError, resolveLegalDocumentsManifest } from "./legal-documents";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryQuotaError,
  confirmOwnedUpload,
  createUpload,
  expireOwnedUpload,
  getCurrentLegalAcceptanceStatus,
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

function contentSecurityPolicy(env: Env): string {
  const r2Origin = isR2TransferAvailable(env)
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

export const app = new Hono<AppBindings>();

app.use("*", async (context, next) => {
  await next();
  context.header("Content-Security-Policy", contentSecurityPolicy(context.env));
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
        privateAudioUpload: isR2TransferAvailable(context.env),
      },
      kind: owner.kind,
      ownerId: owner.ownerId,
    },
    error: null,
    requestId: createRequestId(),
  });
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

app.get("*", (context) => context.env.ASSETS.fetch(context.req.raw));

app.onError((error, context) => {
  console.error(
    JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      event: "request_failed",
      route: context.req.path,
    }),
  );
  return errorResponse(context, 500, "INTERNAL_ERROR", "The request could not be completed.", true);
});

export default app;
