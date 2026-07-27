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
Use SPA fallback for browser navigation. The Worker serves a public product overview and legal pages,
then applies the ADR-010 authentication boundary before the private application or API is reached.

**Reason:** One origin avoids CORS and split-deployment drift. Cloudflare Workers Builds can deploy the
complete application from the public GitHub repository without storing Cloudflare credentials in the
repository.

## ADR-010: Cloudflare Access authentication for the private beta

**Status:** Accepted

Keep `/`, `/login`, legal pages, `/health`, and `/legal/documents.json` public. Require an interactive Cloudflare
Access identity for `/app*` and `/api/*`, then independently verify `Cf-Access-Jwt-Assertion` inside
the Worker. Derive the application owner ID from the verified Access issuer and subject; never accept
an owner ID from a browser header, cookie, URL, or request body.

Cloudflare Access owns the login session. D1 stores only a one-way subject hash and the derived owner
ID, not passwords, Access JWTs, session cookies, or user email addresses. A fixed development owner is
allowed only when `APP_ENV` is explicitly `local`, `development`, or `test`.

The bilingual `/login` page is a public entry surface, not an authentication provider. It sends the user
to the protected `/app` path, then the private client verifies `/api/auth/me` before rendering workspace
data. Distinct signed-out, denied, and service-unavailable states fail closed. A disabled registration tab
reserves the future interface location without exposing a registration API or weakening the beta allowlist.

**Reason:** Visitors can understand the project without an account, while Access supplies a maintained
identity-aware boundary for the private beta. Worker-side JWT verification and owner-scoped D1 queries
preserve defence in depth if a protected path or hostname is misconfigured.

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

## ADR-012: One persistent StudyMix Worker service

**Status:** Accepted

Deploy only the `studymix-ai` Worker service. The Worker name is fixed in the checked-in and generated
Wrangler configuration and cannot be replaced by a build setting. Production deploys promote the reviewed
`main` version. Non-production builds may upload preview versions to the same service, but a staging
resource configuration must never be promoted to production traffic. Do not create an environment-suffixed
StudyMix Worker.

Separate staging D1, R2, and Workflow resources may remain isolated from production, but they are not a
reason to keep a second persistent Worker. They may be attached only to an approved preview version after
its Access and route boundary is verified.

**Reason:** A single service avoids duplicate Worker projects, split deployment settings, and accidental
public endpoints while retaining version-level preview and rollback support.
