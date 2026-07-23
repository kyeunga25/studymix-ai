# Architecture

## 1. Architecture decision

Use Cloudflare as the control plane and object-storage layer. Use a replaceable external AI provider as the generation plane.

```text
Browser
  │
  ├── Static application ───────────────► Cloudflare Worker assets
  │
  ├── API metadata ─────────────────────► Worker API
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
  │                                         └── fal.ai ACE-Step
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
  readonly name: "mock" | "fal" | "self-hosted";

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
  ├── validate owner, confirmed upload, rights, quota
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

1. Read only within configured payload limits.
2. Verify the callback if supported.
3. Extract provider request ID.
4. Find the known provider request row.
5. Store a minimal completion signal.
6. Trigger or allow the Workflow to continue.
7. Respond quickly.

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

A future media worker can run `ffprobe` and loudness checks on a CPU container. This is not mandatory for the first vertical slice.

## 12. Authentication strategy

### MVP recommendation

Implement an `OwnerContext` abstraction supporting:

- Development user.
- Anonymous signed session.
- Future authenticated user.

Do not make authentication vendor-specific in domain logic.

For a public beta, add email or social sign-in before payments. The upload, job, and output records must always have an owner ID even for anonymous sessions.

## 13. Abuse controls

- Turnstile token required to create a real-provider job.
- Per-owner daily generation limit.
- Per-IP coarse rate limit.
- Maximum active jobs per owner.
- Maximum upload size.
- Maximum source duration when duration validation is available.
- No arbitrary prompt input in MVP.
- No arbitrary remote source URL.
- Kill switch: `REAL_GENERATION_ENABLED=false`.
- Budget cap checked before submission.
- Provider failures are circuit-breaker signals.

## 14. Configuration

Non-secret configuration in `wrangler.jsonc`:

```text
APP_ENV
GENERATION_PROVIDER
REAL_GENERATION_ENABLED
MAX_UPLOAD_BYTES
UPLOAD_URL_TTL_SECONDS
DOWNLOAD_URL_TTL_SECONDS
SOURCE_RETENTION_HOURS
OUTPUT_RETENTION_HOURS
MAX_DAILY_JOBS_PER_OWNER
ALLOWED_WEB_ORIGINS
```

Secrets:

```text
FAL_KEY
R2_S3_ACCESS_KEY_ID
R2_S3_SECRET_ACCESS_KEY
SESSION_SIGNING_SECRET
TURNSTILE_SECRET_KEY
FAL_WEBHOOK_SECRET      # only if provider supports it
```

Generate Worker binding types using Wrangler. Do not hand-maintain an `Env` interface.

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
- Cost estimate per job.
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

- Separate D1 database and R2 bucket.
- fal provider disabled by default.
- Explicit allowlist for real-generation testers.
- Low daily budget cap.

### Production

- Separate secrets and resources.
- Real generation gated by feature flag.
- Strict allowed origins.
- Retention and cleanup enabled.
- Alerting on cost and failure-rate thresholds.

## 17. Future migration to self-hosted GPU

The provider abstraction allows:

```text
fal.ai
  ↓
RunPod/Modal endpoint running ACE-Step
  ↓
Dedicated GPU when utilization justifies it
```

The web, upload, D1, Workflow, and output contracts should not change. Only provider-specific configuration and adapter code should change.
