# Architecture

## 1. Architecture decision

Use Cloudflare as the control plane and object-storage layer. Use a replaceable external AI provider as the generation plane.

```text
Browser
  │
  ├── Public overview and legal pages ──► Cloudflare Worker assets
  ├── Public `/login` ──────────────────► Worker assets
  ├── Protected `/app*` ────────────────► Cloudflare Access ─► Worker assets
  │
  ├── Protected `/api/*` ───────────────► Cloudflare Access ─► Worker API
  │                                         │
  │                                         ├── D1
  │                                         ├── Workflow binding
  │                                         ├── Turnstile verification
  │                                         └── R2 signing service
  │
  ├── Direct PUT upload ────────────────► Private R2 S3 endpoint
  │
  └── Direct signed GET download ◄────── Private R2 S3 endpoint

Workflow
  │
  ├── Submit candidate 1 ───────────────► MusicGenerationProvider
  ├── Submit candidate 2 ───────────────► MusicGenerationProvider
  │                                         ├── credential-free mock
  │                                         └── fal.ai ACE-Step (default-off)
  ├── Poll/verify provider results
  ├── Stream outputs to R2
  ├── Update D1 state
  └── Finish
```

## 2. Why this split

Cloudflare Workers are suitable for:

- Authentication and authorization.
- Metadata APIs.
- D1 access.
- R2 control.
- Workflows and durable state.
- Short requests and orchestration.

The external generation provider is suitable for:

- GPU model execution.
- Queueing model jobs.
- Model loading and scaling.
- Audio-to-audio inference.

The browser transfers large objects directly to R2, preventing Worker memory and request-body limits from becoming the file-transfer bottleneck.

## 3. Monorepo design

```text
apps/web
  src/
    app/
    components/
    features/upload/
    features/jobs/
    features/results/
    lib/api/
    lib/i18n/

apps/api
  src/
    index.ts
    env.ts
    routes/
    middleware/
    repositories/
    services/
    workflows/
    webhooks/
    scheduled/
  migrations/
  wrangler.jsonc

packages/contracts
  src/
    upload.ts
    job.ts
    preset.ts
    errors.ts

packages/core
  src/
    job-state-machine.ts
    retention.ts
    ids.ts
    errors.ts

packages/providers
  src/
    types.ts
    mock-provider.ts
    fal-provider.ts
    provider-factory.ts

packages/presets
  src/
    presets.ts
    versions/
      v1.ts
```

## 4. Provider abstraction

```ts
export interface MusicGenerationProvider {
  readonly name: "mock" | "fal";

  submit(input: GenerationSubmission): Promise<GenerationSubmissionResult>;

  getStatus(
    providerRequestId: string
  ): Promise<GenerationProviderStatus>;

  getResult(
    providerRequestId: string
  ): Promise<GenerationProviderResult>;

  cancel?(
    providerRequestId: string
  ): Promise<void>;
}
```

Domain code must not import `@fal-ai/client`. Only `fal-provider.ts` may depend on fal-specific code.

The fal adapter uses the asynchronous ACE-Step audio-to-audio queue and validates every queue status,
request identifier, and result with Zod before returning domain data. Submissions disable provider JSON
payload storage, request a bounded output-object lifetime, and may include an HTTPS webhook URL. Result
URLs must use HTTPS on an expected `fal.media` host; only the URL, seed, content type, and file size cross
the adapter boundary. The complete provider response is never persisted.

ACE-Step currently requires `original_tags`, while the MVP does not infer or collect source-style tags.
The adapter therefore sends the pinned preset tags as both the original and target tags. This is a
versioned quality hypothesis, not a claim that the provider will preserve the melody. It must be evaluated
with authorized test audio before real generation is enabled.

The provider factory keeps `mock` usable without credentials. Constructing the real adapter requires
server-side credentials or an explicitly injected queue used by offline tests; browser code never imports
the fal SDK.

### Submission input

```ts
type GenerationSubmission = {
  jobId: string;
  candidateIndex: number;
  sourceAudioUrl: string;
  preset: ResolvedStylePreset;
  idempotencyKey: string;
};
```

### Result

```ts
type GenerationProviderResult = {
  providerRequestId: string;
  status: "completed";
  outputUrl: string;
  seed?: number;
  durationSeconds?: number;
  providerMetadata?: Record<string, string | number | boolean>;
};
```

Do not store arbitrary provider payloads.

## 5. Style preset model

A preset is versioned configuration:

```ts
type StylePreset = {
  id: "soft-piano" | "music-box" | "lofi-study";
  version: 1;
  displayName: {
    en: string;
    "zh-HK": string;
  };
  description: {
    en: string;
    "zh-HK": string;
  };
  providerParameters: {
    targetTags: string;
    lyrics: "[inst]";
    editMode: "remix";
  };
  policy: {
    disallowArtistNames: true;
    instrumentalOnly: true;
  };
};
```

Suggested v1 prompts:

### Soft Piano

```text
instrumental, soft solo piano, recognizable central melody,
gentle dynamics, sparse accompaniment, calm study music,
natural piano room, no vocals
```

### Music Box

```text
instrumental, delicate music box, recognizable central melody,
sparse arrangement, gentle mechanical character,
calm bedtime and study music, no vocals
```

### Lo-fi Study

```text
instrumental, relaxed lofi study music, warm electric piano,
recognizable central melody, restrained soft drums,
subtle tape texture, mellow dynamics, no vocals
```

These strings are hypotheses and must be benchmarked. Do not claim that they guarantee melody preservation.

## 6. Upload flow

1. Client requests `POST /api/uploads`.
2. API validates filename metadata and session quota.
3. API creates a server-generated object key.
4. API creates an upload row in D1.
5. API returns a short-lived R2 S3 `PUT` presigned URL.
6. Browser uploads directly to the R2 S3 endpoint.
7. Client calls confirm.
8. API checks R2 object metadata using its binding or trusted server access.
9. API marks the upload `confirmed`.

### Security rules

- Do not accept arbitrary destination keys from the client.
- Use one object per presigned URL.
- Expire upload URLs quickly.
- Configure R2 CORS only for required origins, methods, and headers.
- Enforce size both before and after upload.
- Treat content type as untrusted metadata.
- A later CPU media-validation service may inspect magic bytes and decode the audio.
- Do not allow server-side fetch from URLs supplied by the user.

## 7. Job flow

```text
POST /api/jobs
  │
  ├── validate owner, current legal acceptance, confirmed upload, rights, quota
  ├── insert job in D1
  ├── create Workflow with instance ID derived from job ID
  └── return 202

Workflow.run
  │
  ├── step: mark validating
  ├── step: resolve preset
  ├── step: create short-lived source URL
  ├── step: submit provider requests
  ├── step: wait/poll for candidate completion
  ├── step: ingest and validate each output
  ├── step: store each output in R2
  ├── step: mark completed
  └── step: record usage
```

Each `step.do` body must be safe to retry.

### Verified generation Workflow slices

The credential-free `GENERATION_PROVIDER=mock` mode validates the external Workflow payload with Zod,
pins the preset version, uses the job ID as the Workflow instance ID, and stores two bounded synthetic
WAV tones through the private R2 binding. Provider requests, outputs, rights evidence, usage, and every
state transition are owner-scoped and idempotent. R2 writes use a create-only condition and verify
existing object metadata on a retry. The source object is not read or sent to any external service in
mock mode.

The same feature-gated Workflow can select `GENERATION_PROVIDER=fal` only when the real-generation kill
switch, private R2 transfer, Workflow binding, server secret, and bounded queue/output settings are all
valid. It re-verifies the confirmed, unexpired source object; creates the short-lived signed source URL
inside the sensitive submission step; prevents automatic retry after an ambiguous external submission;
persists the returned request ID; polls with fixed attempt and sleep limits; and streams the allowlisted
provider result into private R2 before recording completion. Neither the signed source URL nor the
provider output URL is returned from a Workflow step or stored in D1. CI configuration is deliberately
invalid for real generation and no automated test makes a provider request.

`POST /api/jobs`, `GET /api/jobs/:jobId`, and the output-download route remain behind authentication.
The client receives only public job metadata and short-lived signed playback URLs, never R2 object keys
or Workflow internals. The production-default flags keep R2 transfer, the Workflow, and real generation
disabled.

## 7.1 Legal-document and acceptance boundary

The legal documents are versioned public contracts shared by the API and web build. The Worker exposes:

```text
GET  /legal/documents.json   -> public configured contact + current document manifest
GET  /api/legal/documents    -> authenticated compatibility manifest
GET  /api/legal/acceptances  -> current authenticated-owner status
POST /api/legal/acceptances  -> exact current required versions only
```

`POST` uses a bounded JSON reader, strict Zod parsing, exact version comparison, a server-derived owner,
and a server timestamp. D1 stores one idempotent row per `owner_id + document_id + document_version`.
The Privacy Notice is not included in the acceptance table because necessary data processing should not
be represented as optional consent. The web checkbox acknowledges it while accepting the three
contractual documents.

Every job-creation route must call `hasCurrentLegalAcceptances()` before inserting a job and must
separately persist the upload/job-specific rights declaration. Updating a required document version
automatically makes earlier status non-current without deleting audit history.

## 8. State machine

Allowed transitions:

```text
created -> validating
validating -> queued | failed
queued -> generating | failed | cancelled
generating -> processing_output | failed | cancelled
processing_output -> completed | failed
completed -> expired
failed -> expired
cancelled -> expired
```

Reject all other transitions.

Use a single repository method:

```ts
transitionJob(jobId, expectedCurrentStates, nextState, metadata)
```

Implement transitions transactionally where supported by the selected D1 access pattern.

## 9. Workflows rules

- Use explicit named steps.
- Do not place non-deterministic side effects outside Workflow steps.
- Every provider request receives a stable idempotency key.
- Parallel candidate generation is acceptable only if state updates remain deterministic.
- Bound polling intervals and total attempts.
- Persist provider request IDs immediately after submission.
- Make output ingestion idempotent using `jobId + candidateIndex`.
- Prefer one Workflow instance per job.
- Do not rely only on an incoming webhook to resume correctness.
- Use webhook data to accelerate completion; polling or provider verification remains the source of truth.

## 10. Webhook design

Route:

```text
POST /api/webhooks/fal
```

Handler:

1. Require the configured HTTPS origin and exact path, with no query string.
2. Read the raw JSON body only within the configured payload limit.
3. Require fal's request ID, user ID, timestamp, and signature headers.
4. Enforce the configured fal user and a five-minute timestamp window.
5. Fetch the bounded fal JWKS response and verify the Ed25519 signature over the header values and raw-body
   SHA-256 digest.
6. Require the signed header request ID to match the body and a known fal provider-request row.
7. Send only the request ID and candidate index to the matching Workflow instance; discard the provider
   payload and respond quickly.

The Workflow uses `waitForEvent` only to wake a bounded polling iteration. It always verifies status and
results through the fal queue API, so missing, duplicate, early, or late callbacks are harmless and polling
remains the correctness fallback.

Current implementation references: [fal webhook verification](https://fal.ai/docs/documentation/model-apis/inference/webhooks),
[Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), and
[Workflow events](https://developers.cloudflare.com/workflows/build/events-and-parameters/).

Never trust an output URL solely because it appeared in a webhook.

## 11. Output ingestion

Use streaming:

```text
provider output response body
  ───────── stream ─────────► R2 object
```

Validate:

- HTTP status.
- Redirect policy.
- Maximum response size.
- Content type allowlist.
- Timeout.
- Basic output metadata.
- Non-empty stream.

The implemented ingestion boundary additionally requires HTTPS on an explicit provider-host allowlist,
manual redirect handling, identity content encoding, and a positive trustworthy `Content-Length`. It
streams through a byte-counting transform and a Cloudflare `FixedLengthStream` into private R2 using an
`etagDoesNotMatch: "*"` conditional write. The stored object contains only content type and an ingestion
version marker. Replays first verify the existing private object so an expired provider URL is not fetched
again. Empty, oversized, encoded, redirected, mismatched, or non-audio responses fail closed; no code path
buffers a complete provider audio response in Worker memory. This boundary is connected to the
default-off fal Workflow and has Miniflare integration tests. It is not a claim that external generation
is enabled or production-ready.

## 12. Authentication strategy

### Authentication boundary

Implement an `OwnerContext` abstraction supporting:

- Development user.
- Authenticated Cloudflare Access user.

Do not make authentication vendor-specific in domain logic.

Production and staging have no anonymous owner mode. The product overview, `/login`, legal pages, `/health`, and
`/legal/documents.json` are public and never resolve or create an owner. Cloudflare Access protects
`/app*` and user-facing `/api/*`, and the Worker separately verifies the Access JWT signature, algorithm, issuer,
audience, expiry, application-token type, user subject, and verified email claim. Service tokens are not
accepted as interactive user identities.

The public `/login` page does not collect a password. Its closed-beta action enters the protected `/app`
path so Cloudflare Access can authenticate an invited identity. The client then requests `/api/auth/me`
with `X-Requested-With: XMLHttpRequest`, allowing an expired Access session to be handled as a `401`
instead of an HTML redirect. The Worker verifies the JWT, upserts only the opaque owner identity, checks
that the D1 owner remains active, and returns capabilities before the workspace is rendered. A `401`,
`403`, malformed response, or configuration failure keeps the workspace locked. The disabled registration
tab is presentation-only; no public registration endpoint or anonymous owner path exists.

The exact `/api/webhooks/fal` path is the only provider callback exception to user authentication. A
more-specific Access application may bypass interactive login for that path only; the Worker then requires
fal's Ed25519 signature, expected fal user, fresh timestamp, matching raw body, and known request ID before
signaling a Workflow. The callback route never resolves or creates an owner.

Derive the stable owner ID from a SHA-256 digest of the verified issuer and subject. Store only the
subject hash and owner ID in D1. Never trust `X-User-Id`, `X-Owner-Id`, request bodies, URL parameters,
or unsigned cookies as identity sources. All owner-owned repository reads and writes include the
resolved owner ID in the SQL predicate.

Local development uses one configured development identity and only when `APP_ENV` is explicitly a
non-production value. Unknown environments and incomplete Access configuration fail closed.

## 13. Abuse controls

- Turnstile token required to create a real-provider job.
- A rolling per-owner daily job limit is enforced in the same D1 `INSERT ... SELECT` that creates a job;
  idempotent replays can still return the original job.
- Real-provider job creation calls a Cloudflare Rate Limiting binding with separate owner and SHA-256
  connecting-IP keys before metadata is created. This is a coarse, per-location, eventually consistent
  abuse signal rather than an accounting system.
- Maximum active jobs per owner.
- Maximum upload size.
- Maximum source duration when duration validation is available.
- No arbitrary prompt input in MVP.
- No arbitrary remote source URL.
- Kill switch: `REAL_GENERATION_ENABLED=false`.
- Real-generation kill switch and quota checked before submission.
- Provider failures are circuit-breaker signals.

## 14. Configuration

Non-secret configuration in `wrangler.jsonc`:

```text
APP_ENV
ACCESS_TEAM_DOMAIN
ACCESS_AUD
DEV_AUTH_SUBJECT          # local development only; ignored in production/staging
LEGAL_CONTACT_EMAIL       # real monitored address required outside local/test
GENERATION_PROVIDER
REAL_GENERATION_ENABLED
JOB_WORKFLOW_ENABLED
R2_TRANSFER_ENABLED
MAX_UPLOAD_BYTES
MAX_ACTIVE_UPLOADS_PER_OWNER
MAX_ACTIVE_JOBS_PER_OWNER
MAX_DAILY_JOBS_PER_OWNER
UPLOAD_URL_TTL_SECONDS
DOWNLOAD_URL_TTL_SECONDS
OUTPUT_RETENTION_HOURS
FAL_OUTPUT_EXPIRATION_SECONDS
FAL_QUEUE_START_TIMEOUT_SECONDS
FAL_POLL_INTERVAL_SECONDS
FAL_MAX_POLL_ATTEMPTS
FAL_WEBHOOK_URL
MAX_PROVIDER_OUTPUT_BYTES
PROVIDER_OUTPUT_TIMEOUT_SECONDS
```

Secrets:

```text
FAL_KEY
FAL_WEBHOOK_USER_ID
R2_S3_ACCESS_KEY_ID
R2_S3_SECRET_ACCESS_KEY
TURNSTILE_SECRET_KEY
```

Generate Worker binding types using Wrangler. Do not hand-maintain an `Env` interface.

## 14.1 Data lifecycle and disclosure status

The codebase contains a feature-gated direct-to-private-R2 upload slice, owner-scoped upload and
terminal-job deletion, mock and fal Workflow modes, and an hourly retention handler. The default and
production settings remain `R2_TRANSFER_ENABLED=false`, `JOB_WORKFLOW_ENABLED=false`,
`REAL_GENERATION_ENABLED=false`, and `RETENTION_CLEANUP_ENABLED=false`; no production audio collection
or server-side generation is claimed until a separate staging bucket, exact-origin CORS, signed-URL
expiry, Cron monitoring, and browser checks pass. Cleanup first makes metadata inaccessible, deletes
private R2 objects, then marks object metadata deleted; interrupted deletion remains eligible for the
next run. The configured windows cover unattached uploads and failed artifacts after 24 hours, completed
sources after 72 hours, and outputs after 7 days. External generation remains disabled in production.

Legal acceptance records are metadata evidence, not audio. Their final retention period must be
documented before launch and limited to what is necessary for governing-version proof, security, and
live disputes.

## 14.2 Data recipients, sources, and location claims

- Cloudflare is the current identity, Worker, and D1 processor. Automatic placement and
  location hints do not justify a Hong Kong-only residency claim.
- External generation is disabled in production. The fal adapter requests no JSON payload storage and a
  bounded media expiry, and the Workflow streams outputs into private R2. Real generation must remain
  disabled until provider terms, authorized-audio staging checks, abuse controls, output delivery, and
  deletion behavior are verified end to end.
- The application never ingests user-supplied URLs or scrapes official/third-party data-source sites or
  APIs for tracks.
- A provider URL is untrusted transport input, not a public result or proof of rights. Verified output is
  streamed into private R2 and the provider URL is no longer exposed.

## 15. Observability

Structured log fields:

```text
requestId
event
route
jobId
ownerHash
provider
providerRequestIdHash
candidateIndex
status
durationMs
errorCode
retryable
```

Never log:

- Source or output URLs.
- Presigned query strings.
- API keys.
- Raw audio.
- Original filenames unless sanitized and required.
- Full webhook bodies.
- User IP addresses in application logs unless required and governed.

Operational metrics:

- Upload confirmations.
- Jobs created.
- Jobs completed and failed.
- Provider latency.
- Output-ingestion latency.
- Retry count.
- Expired-object cleanup count.
- Generation success by preset.

## 16. Deployment environments

### Local

- Miniflare/Wrangler local resources.
- Mock generation provider.
- Local fixture audio only.
- No paid API calls.

### Staging

- No separate persistent Worker service. Remote staging uses a non-production version uploaded to the
  same `studymix-ai` Worker and must never receive production traffic.
- Separate D1 database and R2 bucket may be attached only to that approved preview version.
- fal provider disabled by default.
- Explicit allowlist for real-generation testers.

### Production

- The only persistent StudyMix Worker service is `studymix-ai`.
- Separate secrets and resources.
- Real generation gated by feature flag.
- Strict allowed origins.
- Retention and cleanup enabled.
- Alerting on failure-rate thresholds.
