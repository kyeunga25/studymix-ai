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

Deploy the Vite build as Cloudflare Workers Static Assets on the same Worker that serves `/api` and
`/api/*`.
Use SPA fallback for browser navigation. The Worker serves a public product overview and legal pages,
then applies the ADR-010 authentication boundary before the private application or API is reached.

**Reason:** One origin avoids CORS and split-deployment drift. Cloudflare Workers Builds can deploy the
complete application from the public GitHub repository without storing Cloudflare credentials in the
repository.

## ADR-010: Cloudflare Access authentication for the private beta

**Status:** Accepted

Keep `/`, `/login`, legal pages, `/health`, and `/legal/documents.json` public. Require an interactive
Cloudflare Access identity for the exact `/app` and `/api` parents plus `/app/*` and user-facing
`/api/*` deep routes, then independently verify `Cf-Access-Jwt-Assertion` inside the Worker. After JWT
verification, require an active invited D1 owner, active workspace, and active owner membership. Derive
the application owner ID from the verified Access issuer and subject; never accept an owner ID from a
browser header, cookie, URL, or request body.

Cloudflare Access owns the login session. D1 stores only a one-way subject hash, a keyed exact-login
invitation hash, and the derived owner ID, not passwords, Access JWTs, session cookies, or user email
addresses. The invitation is consumed atomically into one active owner workspace with manual AI
approval, bounded job cost, and a bounded idempotent credit grant. A fixed development owner is allowed
only when `APP_ENV` is explicitly `local`, `development`, or `test`.

The bilingual `/login` page is a public entry surface, not an authentication provider. It sends the user
to the protected `/app` path, then the private client verifies `/api/session` before rendering workspace
data. The compatibility `/api/auth/me` route uses the same handler. Session responses expose only
authorization states, role, permissions, approval states, and capabilities; they omit owner and workspace
identifiers. Distinct signed-out, denied, and service-unavailable states fail closed. A disabled
registration tab reserves the future interface location without exposing a registration API or weakening
the beta allowlist.

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

## ADR-013: Append-only private-beta credit ledger

**Status:** Accepted for MVP safety controls

Require an active owner entitlement and reserve a fixed, configured credit quantity in the same D1
batch transaction that creates a generation job. Derive available, reserved, and settled totals from
append-only grant, reserve, settle, and release events. Workflow completion settles the reservation;
terminal failure releases it. Unique owner-scoped reference keys make every operation idempotent.

Credits are a private-beta usage and spend-control unit. They are not public pricing, and the browser
has no credit-grant endpoint.

**Reason:** An append-only ledger is auditable, avoids mutable-balance drift, and remains correct across
duplicate HTTP requests and Workflow retries.

## ADR-014: Isolate future payment providers from the public repository

**Status:** Accepted architecture boundary; provider implementation deferred

Keep the StudyMix application and public repository provider-neutral. A future approved payment service
may be reached only through an authenticated generic Service Binding or equivalent server-to-server
contract. The browser never receives merchant credentials or privileged provider requests. This
repository may contain disabled and synthetic adapters for contract testing, but no live provider
dependency, signing implementation, merchant mapping, or checkout endpoint.

**Reason:** Payment collection is not required for the private audio MVP. Isolating it prevents vendor
details and privileged credentials from leaking into the public application while retaining a testable
domain boundary.

## ADR-015: Keyed owner invitations and server-selected workspaces

**Status:** Accepted for private-beta authorization

Provision owner access through a private operational tool that accepts the exact Access login identity and
an application-specific pepper without echoing either value. Store only the HMAC identity hash in a pending
D1 invitation. After full Access JWT verification, consume that invitation into one active owner, active
workspace, active owner membership, manual AI-approval controls, and an idempotent beta entitlement/grant.
Every private API and Static Assets request must recheck the active D1 scope. The browser receives no owner
or workspace identifier and cannot select a different workspace.

**Reason:** Access policy is the edge allowlist, while D1 supplies revocable application authorization,
role, spend cap, approval state, and a stable scope for future private jobs. Keyed hashing avoids storing a
guessable email digest, and server selection prevents cross-workspace client assertions from becoming an
authorization source.

## ADR-016: Loopback-only synthetic orchestration harness

**Status:** Accepted for local development only

Exercise the canonical owner, legal acceptance, rights declaration, job, credit, Workflow, and private
object-storage paths with a deterministic provider-neutral audio adapter. The harness is available only
when `APP_ENV=local`, the request host is loopback, the mock provider is selected, the real-generation
kill switch is off, and every required local binding flag is explicitly on. It uses local-only additive
test state for orchestration policy and attempt-cost metadata; production migrations and checked-in
Wrangler defaults are unchanged.

Provider-attempt cost units remain separate from customer credits. A valid private output settles the
customer reservation, terminal failure or cancellation releases it, and provider work already attempted
is retained as synthetic cost evidence. Duplicate or late wake-up signals never authorize a state
transition by themselves; the Workflow re-reads server state.

**Reason:** The application needs a reproducible browser-to-Workflow integration path before any real
provider, remote binding, or paid request can be approved. A loopback and environment double gate keeps
that capability unavailable to deployed environments while testing the same application lifecycle.
