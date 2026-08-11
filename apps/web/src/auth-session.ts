import { apiEnvelopeSchema } from "@studymix/contracts";
import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import { z } from "zod";
import { readBoundedWebJsonResponse } from "./bounded-json-response";
import { isWebRequestInterruption, withWebJsonRequestTimeout } from "./request-timeout";

const workspacePermissionSchema = z.enum([
  "workspace:read",
  "workspace:manage",
  "jobs:create",
  "jobs:read",
  "credits:read",
  "approvals:manage",
]);

const privateSessionSchema = apiEnvelopeSchema(
  z
    .object({
      authorization: z
        .object({
          accountStatus: z.literal("active"),
          aiJobApprovalMode: z.literal("manual"),
          membershipStatus: z.literal("active"),
          paymentStatus: z.enum(["disabled", "review_required", "approved"]),
          permissions: z.array(workspacePermissionSchema).min(1),
          realProviderStatus: z.enum(["disabled", "review_required", "approved"]),
          role: z.literal("owner"),
          workspaceStatus: z.literal("active"),
        })
        .strict(),
      capabilities: z
        .object({
          creditAccounting: z.boolean(),
          localAiHarness: z.boolean(),
          mockGeneration: z.boolean(),
          privateAudioUpload: z.boolean(),
          realGeneration: z.boolean(),
          retentionCleanup: z.boolean(),
        })
        .strict(),
      kind: z.enum(["authenticated", "development"]),
    })
    .strict(),
);

export type PrivateSession = NonNullable<z.infer<typeof privateSessionSchema>["data"]>;
export type PrivateAccessStatus = "checking" | "denied" | "signed-out" | "unavailable" | "verified";

export type PrivateSessionResult =
  | { session: PrivateSession; status: "verified" }
  | { session: null; status: Exclude<PrivateAccessStatus, "checking" | "verified"> };

const unavailablePrivateSessionResult = {
  session: null,
  status: "unavailable",
} as const satisfies PrivateSessionResult;

async function requestPrivateSession(
  signal: AbortSignal,
  request: typeof fetch,
): Promise<PrivateSessionResult> {
  const response = await request("/api/session", {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      [privateApiRequestHeaderName]: privateApiRequestHeaderValue,
    },
    signal: withWebJsonRequestTimeout(signal),
  });

  if (response.status === 401) {
    return { session: null, status: "signed-out" };
  }
  if (response.status === 403) {
    return { session: null, status: "denied" };
  }
  if (!response.ok) {
    return unavailablePrivateSessionResult;
  }

  let body: unknown;
  try {
    body = await readBoundedWebJsonResponse(response);
  } catch (error) {
    if (isWebRequestInterruption(error)) {
      throw error;
    }
    return unavailablePrivateSessionResult;
  }
  const parsed = privateSessionSchema.safeParse(body);
  if (!parsed.success || parsed.data.error !== null || parsed.data.data === null) {
    return unavailablePrivateSessionResult;
  }

  return { session: parsed.data.data, status: "verified" };
}

export async function loadPrivateSession(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<PrivateSessionResult> {
  try {
    return await requestPrivateSession(signal, request);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    try {
      return await requestPrivateSession(signal, request);
    } catch (retryError) {
      if (retryError instanceof DOMException && retryError.name === "AbortError") {
        throw retryError;
      }
      return unavailablePrivateSessionResult;
    }
  }
}
