# Architecture Decisions

## ADR-001: Cloudflare control plane

**Status:** Accepted for MVP

Use Workers, D1, R2, and Workflows for the web application, metadata, object storage, and orchestration.

**Reason:** It keeps identity, metadata, object storage, orchestration, and edge delivery within one control plane.

## ADR-002: External GPU provider

**Status:** Accepted for MVP

Use fal.ai ACE-Step audio-to-audio behind a provider adapter.

**Reason:** It keeps GPU execution behind a vendor adapter without exposing provider credentials to the browser.

## ADR-003: Provider portability

**Status:** Accepted

Domain logic must depend on `MusicGenerationProvider`, not fal-specific contracts.

**Reason:** Model endpoints, schemas, policies, and quality can change.

## ADR-004: Direct R2 transfer

**Status:** Accepted

Use browser-to-R2 upload and signed R2 download.

**Reason:** Large audio files should not be buffered or proxied through Worker request memory.

## ADR-005: Two candidates

**Status:** Accepted for MVP

Generate two candidates for each job.

**Reason:** Audio generation is stochastic. Candidate choice is a simpler quality-control mechanism than building an automated musical judge in the MVP.

## ADR-006: Restricted presets

**Status:** Accepted for MVP

Only Soft Piano, Music Box, and Lo-fi Study are exposed.

**Reason:** Controlled prompts reduce product complexity, abuse risk, and benchmark variance.

## ADR-008: Rights-holder positioning

**Status:** Accepted

Position the product for recordings the user owns or is authorized to process.

**Reason:** Model licensing does not grant rights to adapt third-party recordings.

## ADR-009: One Worker for the SPA and API

**Status:** Accepted

Deploy the Vite build as Cloudflare Workers Static Assets on the same Worker that serves `/api/*`.
Use SPA fallback for browser navigation. ADR-010 supersedes the original API-only Worker routing and
requires every asset route to invoke authentication before using the static-assets binding.

**Reason:** One origin avoids CORS and split-deployment drift. Cloudflare Workers Builds can deploy the
complete application from the public GitHub repository without storing Cloudflare credentials in the
repository.

## ADR-010: Cloudflare Access authentication for the private beta

**Status:** Accepted

Require an interactive Cloudflare Access identity before serving the SPA or any API route. Configure
Access against the entire Worker, then independently verify `Cf-Access-Jwt-Assertion` inside the
Worker. Derive the application owner ID from the verified Access issuer and subject; never accept an
owner ID from a browser header, cookie, URL, or request body.

Cloudflare Access owns the login session. D1 stores only a one-way subject hash and the derived owner
ID, not passwords, Access JWTs, session cookies, or user email addresses. A fixed development owner is
allowed only when `APP_ENV` is explicitly `local`, `development`, or `test`.

**Reason:** Access supplies a maintained identity-aware login boundary for the private beta, while Worker-side JWT verification and
owner-scoped D1 queries preserve defence in depth if a route or hostname is misconfigured.

## ADR-011: Versioned legal acceptance and fail-closed provider activation

**Status:** Accepted for MVP

Publish dated Terms of Use, Privacy Notice, Acceptable Use Policy, and AI and Output Notice in English
and Traditional Chinese. The Worker, not the browser, owns the current required versions. It stores
idempotent evidence by verified owner, document, version, and server time. A job route must require
current Terms, AUP, and AI/output acceptance plus a separate job-specific rights declaration. The Privacy
Notice is acknowledged but is not represented as optional consent for processing necessary to deliver
the service.

Production legal endpoints fail closed until a real contact is configured. Real audio/provider features
remain disabled until the published retention claims, user deletion, provider DPA/terms, no-payload
storage, media ACL/expiry, subprocessor, model-provenance, and cross-border disclosures are verified.

**Reason:** Static disclaimers do not enforce the governing version or prove which authenticated owner
accepted it. Separating necessary privacy notice from contractual acceptance avoids misleading consent,
while fail-closed release gates prevent planned deletion or third-party controls from being presented as
already operational.
