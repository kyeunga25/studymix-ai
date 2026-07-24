import {
  acceptLegalDocumentsRequestSchema,
  currentLegalAcceptanceDocuments,
  type ApiErrorCode,
} from "@studymix/contracts";
import { Hono, type Context } from "hono";
import { AuthenticationError, resolveOwnerContext, type OwnerContext } from "./auth/owner-context";
import { LegalConfigurationError, resolveLegalDocumentsManifest } from "./legal-documents";
import {
  getCurrentLegalAcceptanceStatus,
  recordCurrentLegalAcceptances,
  upsertOwner,
} from "./repositories";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  UnsupportedJsonMediaTypeError,
  readBoundedJson,
} from "./request-json";

type AppBindings = {
  Bindings: Env;
  Variables: {
    owner: OwnerContext;
  };
};

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function createRequestId(): string {
  return crypto.randomUUID();
}

function errorResponse(
  context: Context<AppBindings>,
  status: 400 | 401 | 403 | 409 | 413 | 415 | 500 | 503,
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

export const app = new Hono<AppBindings>();

app.use("*", async (context, next) => {
  await next();
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
