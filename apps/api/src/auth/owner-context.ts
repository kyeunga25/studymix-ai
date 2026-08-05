import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { isLoopbackRequest } from "../local-runtime";

const ACCESS_TOKEN_HEADER = "cf-access-jwt-assertion";
const DEVELOPMENT_ISSUER = "urn:studymix:development";
const INVITATION_HASH_CONTEXT = "studymix-owner-invite-v1";

const accessClaimsSchema = z
  .object({
    email: z.email(),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    nbf: z.number().int().positive(),
    sub: z.uuid(),
    type: z.literal("app"),
  })
  .passthrough();

const accessAudienceSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const developmentSubjectSchema = z.string().trim().min(8).max(128);
const ownerIdentityPepperSchema = z
  .string()
  .trim()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => !/change[-_ ]?me/i.test(value));

export type OwnerContext = {
  authIssuer: string;
  authSubjectHash: string;
  invitationIdentityHash: string | null;
  kind: "authenticated" | "development";
  ownerId: string;
};

export type AuthEnvironment = {
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  APP_ENV: string;
  DEV_AUTH_SUBJECT: string;
  OWNER_IDENTITY_PEPPER: string;
};

type AccessJwtVerifier = (token: string, issuer: string, audience: string) => Promise<JWTPayload>;

export class AuthenticationError extends Error {
  constructor(
    readonly reason: "AUTH_CONFIGURATION_INVALID" | "AUTH_TOKEN_INVALID" | "AUTH_TOKEN_MISSING",
    readonly status: 401 | 503,
  ) {
    super(reason);
    this.name = "AuthenticationError";
  }
}

const remoteJwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRemoteJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = remoteJwksByIssuer.get(issuer);
  if (existing !== undefined) {
    return existing;
  }

  const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  remoteJwksByIssuer.set(issuer, jwks);
  return jwks;
}

const verifyAccessJwt: AccessJwtVerifier = async (token, issuer, audience) => {
  const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
    algorithms: ["RS256"],
    audience,
    clockTolerance: 5,
    issuer,
    requiredClaims: ["aud", "email", "exp", "iat", "iss", "nbf", "sub", "type"],
  });

  return payload;
};

function normalizeAccessIssuer(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createOwnerContext(
  issuer: string,
  subject: string,
  kind: OwnerContext["kind"],
  invitationIdentityHash: string | null,
): Promise<OwnerContext> {
  const identityBytes = new TextEncoder().encode(`${issuer}\u0000${subject}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", identityBytes));
  const subjectHash = bytesToHex(digest);

  return {
    authIssuer: issuer,
    authSubjectHash: subjectHash,
    invitationIdentityHash,
    kind,
    ownerId: `own_${subjectHash.slice(0, 32)}`,
  };
}

function normalizeLoginIdentity(value: string): string {
  return value.trim().toLowerCase();
}

async function createInvitationIdentityHash(identity: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${INVITATION_HASH_CONTEXT}\u0000${normalizeLoginIdentity(identity)}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function resolveOwnerContext(
  request: Request,
  environment: AuthEnvironment,
  verifier: AccessJwtVerifier = verifyAccessJwt,
): Promise<OwnerContext> {
  if (
    environment.APP_ENV === "test" ||
    ((environment.APP_ENV === "development" || environment.APP_ENV === "local") &&
      isLoopbackRequest(request))
  ) {
    const parsedSubject = developmentSubjectSchema.safeParse(environment.DEV_AUTH_SUBJECT);
    if (!parsedSubject.success) {
      throw new AuthenticationError("AUTH_CONFIGURATION_INVALID", 503);
    }

    return createOwnerContext(DEVELOPMENT_ISSUER, parsedSubject.data, "development", null);
  }

  if (environment.APP_ENV !== "production" && environment.APP_ENV !== "staging") {
    throw new AuthenticationError("AUTH_CONFIGURATION_INVALID", 503);
  }

  const issuer = normalizeAccessIssuer(environment.ACCESS_TEAM_DOMAIN);
  const audience = accessAudienceSchema.safeParse(environment.ACCESS_AUD);
  const identityPepper = ownerIdentityPepperSchema.safeParse(environment.OWNER_IDENTITY_PEPPER);
  if (issuer === null || !audience.success || !identityPepper.success) {
    throw new AuthenticationError("AUTH_CONFIGURATION_INVALID", 503);
  }

  const token = request.headers.get(ACCESS_TOKEN_HEADER);
  if (token === null || token.length === 0) {
    throw new AuthenticationError("AUTH_TOKEN_MISSING", 401);
  }
  if (token.length > 16_384) {
    throw new AuthenticationError("AUTH_TOKEN_INVALID", 401);
  }

  try {
    const payload = await verifier(token, issuer, audience.data);
    const claims = accessClaimsSchema.parse(payload);
    const invitationIdentityHash = await createInvitationIdentityHash(
      claims.email,
      identityPepper.data,
    );
    return await createOwnerContext(issuer, claims.sub, "authenticated", invitationIdentityHash);
  } catch {
    throw new AuthenticationError("AUTH_TOKEN_INVALID", 401);
  }
}
