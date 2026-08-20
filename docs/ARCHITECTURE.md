# Architecture

> **Repository design only:** This specification explains reviewable source-code boundaries. It must
> never contain live Cloudflare identifiers, private hostnames, real application data, database dumps,
> secrets, account-specific topology or incident evidence. See
> [`PUBLICATION_SAFETY.md`](PUBLICATION_SAFETY.md).

## 1. Architecture decision

Use Cloudflare as the control plane and object-storage layer. Use a replaceable external AI provider as the generation plane.

```text
Browser
  │
  ├── Public overview and legal pages ──► Cloudflare Worker assets
  ├── Public `/login` ──────────────────► Worker assets
  ├── Protected `/app`, `/app/*` ───────► Cloudflare Access ─► Worker assets
  │
  ├── Protected `/api`, `/api/*` ───────► Cloudflare Access ─► Worker API
  │                                         │
  │                                         ├── D1
  │                                         │    └── owner entitlement + append-only credit ledger
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
URLs must use HTTPS on the standard port of an expected `fal.media` host; only the URL, seed, content
type, and file size cross the adapter boundary. The complete provider response is never persisted.

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
  id:
    | "soft-piano"
    | "music-box"
    | "lofi-study"
    | "acoustic-ease"
    | "slowwave"
    | "kissa-jazzhop";
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

### Acoustic Ease

```text
instrumental, simple acoustic guitar, optional soft piano accompaniment,
recognizable central melody, light fingerpicked arrangement, gentle dynamics,
warm natural room, calm study music, no vocals
```

### Slowwave

```text
instrumental, slow-paced ambient electronic music, recognizable central melody,
soft synth pads, gentle pulse, restrained percussion, warm spacious texture,
calm study music, no vocals
```

These strings are hypotheses and must be benchmarked. Do not claim that they guarantee melody preservation.

## 6. Upload flow

1. The browser accepts exactly one selected file and immediately validates it with the shared Zod upload
   contract: supported audio MIME type and aliases, non-empty bytes, the 500 MB client limit, and safe
   filename metadata. The picker advertises only these explicit formats instead of the broader `audio/*`
   category. A rejected selection is cleared, announced accessibly in the selected language, and makes
   no upload request. Immediately before upload creation, the browser also uses the shared bounded
   random-access inspector against `File.slice()` ranges. It requires recognizable MP3 frames, RIFF/WAVE
   chunks, an M4A audio track, AAC ADTS frames, or an Ogg audio identification packet matching the normalized
   MIME type. Failure gets a bilingual accessible error and sends neither upload metadata nor file bytes.
   The inspector never buffers the complete selected file.
2. The client creates one `ui-upload:` idempotency key and requests `POST /api/uploads`. If the request has
   an ambiguous network failure, the client makes at most one automatic retry with the same key and metadata;
   aborts, validation failures, conflicts, and invalid responses are not retried by this recovery path.
3. API accepts only `application/json`, streams at most 4 KiB, and independently validates strict
   filename metadata, content type, size, idempotency key, and session quota. A body or schema failure creates
   no upload row and returns no signed destination.
4. API creates a server-generated object key.
5. D1 atomically inserts the upload under the active-owner quota and a unique `owner_id + idempotency_key`
   constraint, storing a SHA-256 fingerprint of the canonical metadata. The quota adds two owner-scoped
   partial-index counts: unexpired `pending` rows via an expiry range plus `confirmed` rows, so historical
   inactive rows do not expand either count. An exact sequential or concurrent replay resolves to the same
   pending row; changed metadata conflicts, and another owner remains independent. A confirmed, expired, or
   deleted row is never resurrected by replay.
6. API returns the matching idempotency key and a short-lived R2 S3 `PUT` presigned URL. A safe replay signs
   the existing server-controlled object using its stored lifetime rather than creating another row or key.
7. Before any audio leaves the device, the client first binds the response to its request idempotency key,
   then verifies that the instruction uses the expected
   standard-port Cloudflare R2 S3 endpoint, one complete set of short-lived signing parameters, the
   server-controlled upload key and ID, the signed content-type and no-overwrite headers, and a
   sufficient size limit. The credential date, strict UTC signing timestamp, signed TTL, and declared
   expiry must describe the same still-active lifetime, subject only to bounded future clock skew and
   the signing format's one-second precision. The method-specific signed-header list must match exactly;
   duplicate or additional headers that the upload instruction does not provide are rejected.
8. Browser uploads directly to the R2 S3 endpoint. While that potentially long transfer is active, a
   bilingual accessible control can abort it; unmounting the private application also aborts the transfer.
   If the client already knows the server-generated upload ID, cancellation uses a separate, non-aborted,
   15-second private API signal for best-effort owner-scoped metadata／object cleanup. The server-side expiry
   path remains the fallback when the ID or cleanup response is unavailable. The selected file, rights, and
   legal choices remain in the private UI so the user can retry deliberately.
9. Client calls confirm. If the first confirmation attempt ends in a normalized network error with an
   unknown outcome, the browser repeats the same owner-scoped upload-ID `POST` exactly once without repeating
   the direct R2 `PUT`. Caller abort, API error, invalid response, response mismatch, or a second network
   failure is not automatically resubmitted. Sequential and simultaneous server replays remain owner-scoped
   and idempotent. A sequential confirmed replay checks its stored expiry before success: a still-valid row
   returns the same metadata without another R2 read, while an expired row returns `UPLOAD_EXPIRED` and
   remains under the existing job／retention lifecycle rather than being deleted inside the confirmation
   request.
10. For a pending upload, API checks R2 object metadata using its binding or trusted server access, then
    reuses the shared bounded inspector through R2 range reads pinned to the `HEAD` ETag. A missing／changed
    object or temporary range-read failure remains retryable and does not purge a potentially valid object.
    A stable object whose supported audio structure contradicts the declared MIME is made unusable and
    removed through the owner-scoped unattached-upload cleanup path before confirmation.
11. API uses a guarded `pending → confirmed` D1 update. If two requests already validated the same object,
    the transition loser may read back the winner only when owner, upload ID, exact bytes, confirmed state,
    confirmation timestamp, and still-valid retention lifetime all match; it returns the winner's timestamps
    instead of creating a second state or surfacing an internal error.
12. API returns the owner-scoped public metadata.
13. Before enabling job creation, the client requires the confirmation to match the requested upload ID,
    normalized filename, content type, and exact bytes; status must be `confirmed`, `confirmedAt` must be
    present and ordered after creation, and the source expiry must remain in the future. A mismatch triggers
    best-effort cleanup of the original upload and leaves the file／rights／legal state available for retry.

### Security rules

- Do not accept arbitrary destination keys from the client.
- Use one object per presigned URL.
- Expire upload URLs quickly.
- Configure R2 CORS only for required origins, methods, and headers.
- Treat client-side validation as immediate feedback only; authorization and validation remain
  server-enforced.
- Scope upload idempotency by owner, fingerprint the complete upload metadata, and reuse the exact key only
  for bounded recovery of an ambiguous create failure. Never let replay bypass the active-upload quota or
  revive a non-pending upload.
- Reject an upload response carrying another idempotency key before issuing a direct `PUT`. Do not delete the
  response resource in this case because it has not been bound to the current request.
- Reject an inconsistent or untrusted presigned upload instruction before issuing the direct `PUT`,
  request owner-scoped metadata cleanup, and retain server-side expiry as the cleanup fallback.
- Keep user cancellation distinct from transfer failure, never reuse its aborted signal for cleanup, and do
  not proceed to confirmation after an aborted `PUT`.
- Make upload confirmation a guarded, owner-scoped idempotent transition. A concurrent loser may reuse only
  the same valid confirmed row and exact object bytes; never accept another owner or an expired／mismatched
  state as replay success.
- Check a confirmed row's expiry before returning an idempotent success. Reuse a still-valid row without a
  redundant R2 read, and leave expired confirmed-source cleanup to the guarded job／retention lifecycle.
- Retry confirmation exactly once only after a normalized network failure, using the same validated upload
  ID and no second audio `PUT`; preserve caller aborts and parsed API／response failures without resubmission.
- Validate an upload ID before a cleanup URL is constructed, and require the delete response to identify the
  same upload before clearing local state. The Worker independently enforces owner scope for both routes.
- Treat upload cleanup as an owner-scoped, two-phase state transition: first make unattached metadata
  unusable and immediately eligible for retention, then delete the private R2 object, and only then record
  the final deleted state. A failed R2 operation stays eligible for scheduled cleanup or a same-owner
  replay; a concurrent confirmation, attached job, or different owner cannot reclaim the row. After local
  ID validation, the browser repeats the identical `DELETE` exactly once only when the first result is a
  normalized network error; caller abort, API error, invalid／mismatched response, and a second network error
  are not automatically resubmitted.
- Enforce size both before and after upload.
- Treat content type as untrusted metadata.
- Use bounded local and ETag-pinned R2 structural inspection for the currently supported MP3, WAV, M4A,
  AAC, and OGG inputs. This recognizes container／frame structure only; it does not prove the file is a song,
  decode the whole recording, assess quality, identify copyrighted material, or replace the rights control.
  A later CPU media-validation service may perform bounded decode／duration／quality checks before any wider
  format set is enabled.
- Do not allow server-side fetch from URLs supplied by the user.

### Shared bounded JSON boundary

Worker request and provider-response JSON readers require a positive safe-integer byte limit and the
`application/json` media type, while allowing ordinary media-type parameters such as UTF-8 charset. They
reject an invalid or oversized declared `Content-Length` before locking the body, then count the actual
streamed chunks independently. The assembled bytes must pass fatal UTF-8 decoding and contain valid JSON.
If cancelling an over-limit stream itself fails, the reader preserves the safe body-too-large
classification instead of leaking the lower-level stream error.

## 7. Job flow

The private browser keeps one deterministic job idempotency key for the selected upload／preset request. Its
job-create client makes at most one automatic retry after a normalized network failure and serializes the
same validated request both times. It does not automatically retry an unkeyed request, caller abort, API
error, conflict, rate limit, or invalid／mismatched response; the existing UI can still offer a deliberate
retry using its stable key.

```text
POST /api/jobs
  │
  ├── stream at most 4 KiB of application/json and validate the strict request contract
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

The job-creation route rejects a non-JSON media type, malformed or oversized JSON, unknown fields,
unsupported candidate counts, and non-current rights-declaration versions before it inserts job, output,
provider-request, rights-declaration, or usage rows. Validation errors do not echo the submitted body.

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
The client receives only public job metadata and short-lived delivery instructions, never standalone
output object-key fields or Workflow internals. The server issues an output instruction only for an
owner-scoped `ready`, unexpired record after an R2 binding `HEAD` confirms the exact stored byte size and
audio content type; pending, expired, missing, or metadata-mismatched objects return no signed URL. Before
inserting a remote playback URL into the document, the client uses the same R2 signing validator as uploads
to bind the standard endpoint, output path, credential/signing dates, TTL, and declared unexpired lifetime
to the requested output ID. The browser repeats the same validated output-ID instruction `POST` exactly once
only after a normalized network error with an unknown outcome. A second network error, caller abort, API
error, invalid／mismatched instruction, or untrusted signature is not automatically resubmitted. This retry
does not include the subsequent local audio content `GET`. An `OUTPUT_EXPIRED` API result discards the whole
candidate pair, keeps the restored job reference, and uses a safe bilingual expiry explanation with only the
existing owner-scoped deletion action; neither the server message nor a replacement job request is exposed.
An `OUTPUT_NOT_READY` result likewise exposes no partial pair or server message, but keeps an explicit
bilingual retry. That user action requests both fresh output instructions without reading or recreating the
job, and only a complete validated pair returns to the result view.
Remote GET instructions must contain exactly the
signed `host` header, with no
duplicate or additional header requirement. A same-origin local-content path is accepted only when the
verified session has the loopback-only local AI capability, it contains that same output ID, and its
declared lifetime remains active. Because media elements cannot attach the private API browser-intent
header, the client never assigns that local path directly to an audio element or download link. It performs
an authenticated bounded fetch instead, requiring a successful `audio/wav` response, a positive exact
`Content-Length` no greater than the shared 64 KiB local policy, an independently matching streamed byte
count, and RIFF／WAVE markers before creating a `blob:` URL. Blob URLs are revoked on refresh, reset,
unmount, and partial-pair failure. Remote R2 instructions remain direct HTTPS media sources and are never
buffered into browser memory by this local-only adapter. One invalid candidate rejects the complete pair
rather than partially rendering mixed or untrusted sources. The completed private result view can discard
and renew both short-lived delivery instructions without creating a new job or provider request; this
control is not shown for browser-only mock results. The production-default flags keep R2 transfer, the
Workflow, and real generation disabled.

Before constructing any job poll／cancel／delete or output-download API path, the web client revalidates the
opaque resource ID with the shared Zod contract. Wrong prefixes, lengths, path suffixes, or query suffixes
produce a local non-retryable validation error and no request. This is an early safety and correctness
boundary only; the Worker still validates route parameters and owner scope independently. Successful poll,
cancel, delete, and output-download responses must also identify the exact requested resource before the
client changes job state or clears private results; a well-formed response for another opaque ID is a
retryable invalid response. A create success is instead bound to the validated upload ID, preset ID／version,
and candidate count because the server generates its job ID; this preserves legitimate idempotent replay
while preventing the client from tracking a different well-formed job.

The browser monitors a pending private job with capped exponential backoff only while the document is
visible. A `visibilitychange` to hidden clears an unstarted timer and aborts an in-flight job read without
incrementing the polling attempt. Returning to visible schedules the same bounded monitor again; it reuses
the existing owner-scoped job ID and never creates another job, provider request, or credit reservation.
Each scheduled read repeats the same `GET` once only after a normalized network error with an unknown
outcome. A second network error, caller abort, API error, or invalid／mismatched response stops at the
existing safe retry UI instead of issuing more requests; both attempts retain the validated job ID and the
Worker's independent owner check.

Job controls use a typed active-action state rather than one ambiguous busy flag. Pending-job read failures
can offer the bounded retry and, only for the loopback harness capability, cancellation; they never display
the terminal-only delete action or a start-over action that could race the still-active job. Completed or
terminal jobs retain deletion, and visible labels change only for the operation actually running. All sibling
actions are disabled until that operation settles, while the Worker continues to enforce state and owner
scope independently.

A server-backed job stores only its validated opaque job ID in same-tab `sessionStorage`. Reload recovery
waits for a verified private session before using the existing owner-scoped job read; filenames, owner IDs,
upload／output IDs, and URLs are never stored there. If browser privacy or quota controls reject the write,
the helper best-effort removes any prior key so a stale job is not later preferred. The current job continues
without weakening the Worker boundary, but the UI presents a bilingual alert to keep the tab open and avoid
reloading until the mix is finished or deleted. An explicit local retry can write only the same validated
active job ID; it sends no API request and accepts success only after reading back that exact ID. A rejected,
silently ignored, or mismatched write best-effort clears any prior key and keeps the warning; an exact read-back
replaces it with a bilingual success status. If the owner-scoped restore instead confirms that the saved job
is no longer available, the browser issues no replacement job request and returns to the workspace. It shows
the translated non-error
status only after `sessionStorage` confirms removal. A browser-rejected removal instead keeps an accurate
bilingual warning and an explicit local-only retry; success clears the key and changes the warning to the safe
new-mix status without another API read. A user-requested start-over with a known saved job likewise keeps the
current job／error screen when removal cannot be read back; its translated local retry clears the reference
before resetting the workspace and never issues another job request. Browser-only mock jobs do not create a
recovery reference.

A successful local cancellation has its own bilingual terminal page. It is announced as a status rather
than a failure alert, states that the reserved beta credits were released, offers no retry, and retains only
the valid terminal deletion action. Deleting it returns to the local synthetic-source starting point with
rights and legal confirmation cleared; failed and expired jobs continue to use the error presentation.

## 7.1 Legal-document and acceptance boundary

The legal documents are versioned public contracts shared by the API and web build. The Worker exposes:

- A legal-acceptance mutation success does not unlock upload or generation from its `current` marker alone.
  The client requires the exact current acceptance-required document IDs／versions and a server timestamp
  for each document; an incomplete or stale but well-formed success remains blocked and retryable.

```text
GET  /legal/documents.json   -> public configured contact + current document manifest
GET  /api/legal/documents    -> authenticated compatibility manifest
GET  /api/legal/acceptances  -> current authenticated-owner status
POST /api/legal/acceptances  -> exact current required versions only
```

`POST` uses a bounded JSON reader, strict Zod parsing, exact version comparison, a server-derived owner,
and a server timestamp. D1 stores one idempotent row per `owner_id + document_id + document_version`.
The browser serializes the fixed current three-document request once and repeats that identical `POST`
exactly once only when the first attempt ends in a normalized network error with an unknown outcome. The
idempotent replay retains the first server timestamp. Caller abort, API or version error, invalid／incomplete
success, and a second network error are returned without another automatic request.
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

The implemented ingestion boundary additionally requires HTTPS on the standard port of an explicit
provider-host allowlist, manual redirect handling, identity content encoding, and a positive trustworthy
`Content-Length`. It streams through a byte-counting transform and a Cloudflare `FixedLengthStream` into
private R2 using an `etagDoesNotMatch: "*"` conditional write. The stored object contains only content
type and an ingestion version marker. Replays first verify the existing private object so an expired
provider URL is not fetched again. Empty, oversized, encoded, redirected, mismatched, or non-audio
responses fail closed; no code path buffers a complete provider audio response in Worker memory. This
boundary is connected to the default-off fal Workflow and has Miniflare integration tests. It is not a
claim that external generation is enabled or production-ready.

## 12. Authentication strategy

### Authentication boundary

Implement an `OwnerContext` abstraction supporting:

- Development user.
- Authenticated Cloudflare Access user.

Do not make authentication vendor-specific in domain logic.

Production and staging have no anonymous owner mode. The product overview, `/login`, legal pages, `/health`, and
`/legal/documents.json` are public and never resolve or create an owner. Cloudflare Access protects
the exact `/app` and `/api` parents plus `/app/*` and user-facing `/api/*` deep routes. The Worker
separately verifies the Access JWT signature, algorithm, issuer, audience, expiry, application-token type,
user subject, and verified email claim. Service tokens are not accepted as interactive user identities.
Access signing keys are resolved from the normalized team issuer's exact `/cdn-cgi/access/certs` endpoint.
The JOSE remote-key resolver retains its timeout, manual-redirect, cache, rotation, and key-selection
semantics, while its custom fetch boundary accepts only successful JSON／JWK Set JSON responses of at most
32 KiB. Declared or streamed oversize bodies, invalid UTF-8／JSON, and unexpected successful media types fail
closed before JOSE sees the key set; non-200 responses remain available for JOSE's normal error handling.

The public `/login` page does not collect a password. Its closed-beta action enters a same-origin,
`/app`-scoped destination so Cloudflare Access can authenticate an invited identity and return a successful
session directly to the workspace. The client then requests the canonical `/api/session` endpoint before
rendering workspace data; `/api/auth/me` remains a compatibility alias. Every private AJAX request sends
`X-Requested-With: XMLHttpRequest`, allowing an expired Access session to be handled as a `401` instead of
redirected HTML. Session verification repeats that same bounded `GET` exactly once only when the first attempt
has an unknown transport or timeout outcome. Caller abort, HTTP／Access denial, declared or streamed oversize,
invalid media／UTF-8／JSON, and schema mismatch do not trigger another request. This replay is safe because
first-login invitation consumption and existing access-record restoration are atomic and idempotent; the client
still accepts only a complete current session contract. After authenticating a user API request, the Worker also
requires that exact header value
for every method before workspace authorization or any D1 write can run. This includes reads because the
workspace boundary may atomically consume a first-login invitation and records owner activity; treating
those requests as side-effect-free would leave the onboarding path forgeable. Missing, different, or
combined duplicate values receive a non-retryable `403`. This custom-header boundary is a browser CSRF
control, not a replacement for Access authentication, owner authorization, or strict input validation. The
exact signed fal callback is registered before the user API middleware and is therefore not subject to the
browser header. A Worker test derives the registered Hono API handler table, requires that callback to be
the only public API handler, and compares every private method／path with an explicit reviewed manifest.
Each private handler plus parent and unknown deep-path probes must return `401` without production
authentication and `403` without browser intent before any owner or workspace row is created.

After those private boundaries, unmatched `/api` parents, deep paths, and unsupported methods return the
same minimal JSON `NOT_FOUND` envelope with `private, no-store`. Unknown API `GET` requests are intercepted
before the catch-all Static Assets handler, while other methods use the API-aware Hono not-found handler;
neither path returns the SPA shell, echoes the requested path, or adds the private R2 origin to CSP.

The workspace lookup reads the current owner activity timestamp with the authorization row. A successful
private request refreshes `last_seen_at` only when the previous value is at least five minutes old. The
write also requires the same owner ID, active status, and previously read timestamp, so concurrent requests
at the boundary cannot refresh another owner or repeatedly overwrite a newer value. First-login invitation
consumption remains immediate; this bounded refresh only reduces routine private API polling writes and does
not weaken owner, membership, or workspace checks.

The Worker verifies the JWT, derives a keyed one-way hash of the verified email, and requires a matching D1
invitation. The first valid login atomically consumes the invitation into an opaque owner, active workspace,
active owner membership, manual approval controls, private-beta entitlement, and idempotent initial credit
grant. Later requests require the owner, default membership, and workspace all to remain active before
either an API handler or the Static Assets binding runs.

Operator onboarding may revise bounded invitation terms while an invitation is pending or revoked. Once an
invitation is consumed, its initial credit grant is immutable: replaying onboarding can update the bounded
per-job cost and restore the existing access records, but it cannot rewrite the recorded initial grant or mint
another ledger event. Repository tests execute the real D1 migrations and generated onboarding SQL in an
in-memory SQLite database to prove that a replay does not introduce invitation-metadata／ledger drift.

Successful public `GET`／`HEAD` responses for Vite-fingerprinted CSS, JavaScript, PNG, and WebP files under
`/assets/` may use a one-year immutable browser cache only when the response MIME type matches the file
extension. HTML and SPA fallbacks, authenticated application responses, APIs, errors, non-fingerprinted
paths, and MIME mismatches remain `private, no-store`, so no owner-specific or stale fallback content is
shared.

Application markup does not depend on inline style attributes. The decorative waveform heights use a finite,
reviewable set of stylesheet classes, including the private selected-file state. The Worker can therefore
enforce `style-src 'self'` together with `style-src-attr 'none'` without a nonce or `'unsafe-inline'`; Worker
tests assert the header and browser tests assert that public, login, legal, and private routes render without
inline style attributes while retaining visible waveform bars.

The browser entry renders the public product overview synchronously. Login, public legal documents, and the
private application are independent lazy Vite chunks behind an accessible bilingual `Suspense` status. The
public legal chunk owns the versioned legal copy and manifest request; the private chunk owns upload, job,
credit, and session flows. The legal-acceptance helper loads only after the signed-in owner submits the
acceptance form, while the loopback synthetic-source helper loads only when that local capability prepares a
fixture. Neither mutation consumes the private-route startup budget. Only small private-API and bilingual
site-chrome modules are shared. A redacted bilingual error
boundary offers reload or return-to-overview controls if a deferred chunk cannot load; technical error
details are not rendered. Exact route classification keeps `/app` and `/app/*` on the private client route
while unknown or lookalike paths fall back to the public overview; this client classification does not
replace the Worker's authentication and workspace authorization before private Static Assets or API
handling.

Public links preload their matching login or legal chunk on pointer hover and keyboard focus; the login
action similarly preloads the private application chunk only when its validated destination is `/app` or a
deep `/app/*` path. These speculative imports are failure-tolerant static downloads only: they do not render
the target route, navigate, verify a session, or request workspace data. Normal navigation remains guarded
by the same route error boundary and server authorization.

Public legal-manifest and private browser API clients share a 64 KiB JSON response boundary instead of
calling `Response.json()` directly. A successful response must declare `application/json`; a declared length
is checked before body consumption and decoded stream chunks are counted independently. Missing bodies,
invalid UTF-8／JSON, unexpected media types, and declared or actual oversize responses fail closed through
the existing unavailable／retryable UI states. Abort errors remain aborts, and no rejected body or parsing
detail is rendered to the user.

Private job errors are presented from a closed, typed code union rather than from the server-provided
message or request ID. An exhaustive switch maps every current API and browser-only job error code to
reviewed English and Traditional Chinese guidance; adding a contract code therefore fails typecheck until
the presentation is classified. The shared private API client still announces `401`／`403` access failures
for route-level sign-in or denied handling before this local fallback copy is relevant. A unit matrix covers
the complete code union, while Chromium flows retain the interaction proof for credit and output failures.

Those small JSON requests also combine the component's cancellation signal with a fixed 15-second request
deadline. The same signal remains attached while the bounded body stream is consumed, so either a stalled
header or stalled JSON body resolves to the existing unavailable／retryable state. Navigation and unmount
cancellation retains its `AbortError` semantics; a deadline `TimeoutError` is not mistaken for navigation.
Mutation and job clients map it to a retryable network failure, while session, legal, and credit readers use
their existing unavailable states. This short deadline does not apply to the potentially large direct R2
audio `PUT`, which retains its caller-controlled transfer signal and is still bounded by the validated file
size and signed instruction.

The production Vite build also enforces a fail-closed bundle budget. It requires exactly one anonymous entry,
login, public-legal, private-app, job-experience, entry CSS, and study-room background artifact, then checks
both individual and aggregate raw／gzip sizes. Limits use decimal bytes: entry JS 300／95 kB, all JS 420／135
kB, login JS 15／6 kB, public-legal JS 40／17 kB, private-app JS 60／20 kB, job-experience JS 24／8 kB, entry
CSS 20／5 kB, all CSS 55／15 kB, and the background WebP 110／105 kB. Missing, duplicate, invalid, or
oversized output stops the build; diagnostics use only public artifact roles, emitted filenames, and byte
counts rather than local module paths.

The same build gate constrains the public output surface to one `index.html`, fingerprinted JavaScript／CSS,
and the single reviewed `study-room-bg` WebP. Source maps, JSON, audio, additional images, unhashed assets,
unexpected root files, and every other output type stop the build. Unexpected-artifact diagnostics expose
only the artifact position and extension, never its filename or source path; adding any new public binary
therefore requires an explicit contract and publication-safety review.

The generated `index.html` has its own content contract: valid UTF-8, exactly one empty external module
script, exactly one external stylesheet, one application root, and only same-origin fingerprinted JS／CSS
references. Inline scripts, `<style>` blocks, style attributes, inline event handlers, external URLs, and
unhashed references stop the production build. Diagnostics name only the failed rule and never echo HTML or
the referenced URL.

Every generated CSS asset must also be valid UTF-8, contain no `@import` or source-map reference, and either
have no URL or reference only the reviewed same-origin fingerprinted `study-room-bg` WebP. Data URIs,
external／unhashed URLs, malformed URL syntax, and any other CSS-loaded asset stop the build without echoing
the value. With no legitimate data-image dependency, the Worker CSP limits `img-src` to `'self'` rather than
allowing the `data:` scheme.

CSS follows the same route boundary: the synchronous entry contains only shared reset／fallback rules plus
the public overview styles. Login styles load with the login chunk, public legal documents load only the
shared application／legal stylesheet, and the private application additionally loads the login／private-gate
stylesheet. This keeps the access-verification placeholder styled without making anonymous overview or
public legal requests download unrelated private workspace presentation rules.

A `401`, `403`, malformed session response, or configuration failure keeps the workspace locked and sends
the browser to the public `/login` interface. That interface maps only the fixed `session-expired`,
`access-denied`, and `verification-failed` reasons to bilingual human-readable copy; it never reflects the
API body, and it rejects external or non-`/app` return destinations. A first navigation rejected by Access
at the edge cannot execute application code, so the Access application's identity and non-identity block
pages must use a custom redirect to `/login?reason=access-denied&next=%2Fapp`. The disabled registration tab
is presentation-only; no public registration endpoint or anonymous owner path exists.

The session response contains only active status, role, derived permissions, approval state, and capability
booleans. It does not expose the login identity, invitation hash, owner ID, or workspace ID. A client-supplied
workspace assertion can only confirm the server-selected default workspace; a different or malformed value
is rejected before route logic. The current beta has one active owner workspace. Any future multi-workspace
data model must add workspace predicates to every owner-owned entity before enabling a second active scope.

The exact `/api/webhooks/fal` path is the only provider callback exception to user authentication. A
more-specific Access application may bypass interactive login for that path only; the Worker then requires
fal's Ed25519 signature, expected fal user, fresh timestamp, matching raw body, and known request ID before
signaling a Workflow. The callback route never resolves or creates an owner.

Derive the stable owner ID from a SHA-256 digest of the verified issuer and subject. Store only the
subject hash and owner ID in D1. Store only an HMAC of the normalized login identity for onboarding, with
the pepper held as a Worker secret. Never trust `X-User-Id`, `X-Owner-Id`, request bodies, URL parameters,
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
- Maximum active jobs per owner; the quota predicate uses an owner-scoped partial index containing only
  non-terminal job states, so historical terminal rows do not expand this check.
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
CREDIT_ACCOUNTING_ENABLED
CREDITS_PER_JOB
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

## 14.1 Private-beta credits and future payment isolation

The invited beta uses an owner-scoped, append-only D1 credit ledger as a spend and abuse-control
boundary. It does not publish a price or activate payment collection. The ledger records only positive
`grant`, `reserve`, `settle`, and `release` events with unique owner-scoped reference keys. The
provider-neutral grant repository binds each owner／reference pair to both the `grant` event type and its
quantity, checking before and after its D1 batch so sequential or simultaneous mismatched replays fail with a
conflict. Another owner has an independent reference scope. This helper is not exposed as a browser grant or
top-up route.

Balances are derived rather than updated in place:

```text
available = grants + releases - reserves
reserved  = reserves - settles - releases
settled   = settles
```

First-time job creation predicates its job insert on the current owner aggregate, then records the reserve
event in the same D1 `batch()` transaction. A single D1 database processes queries one at a time and executes
each batch sequentially, so simultaneous owner requests cannot both consume a balance that funds only one
job. An idempotent replay uses the existing job and cannot create a second reservation. Workflow completion
settles once; a terminal Workflow failure releases once. Every query and mutation includes the owner ID, and
the browser receives aggregates only. The aggregate `updatedAt` is the later instant of the owner's
entitlement update and newest owner-scoped ledger event; ISO offsets are compared chronologically, and another
owner's activity cannot advance it. The summary derives balances from an owner-filtered aggregate rather than
materializing the all-owner balance view. An additive expression index follows the chronological owner-scoped
ordering, so the latest-activity lookup remains a covering index search without a temporary sort as the
append-only ledger grows; a Worker query-plan test verifies only those booleans against the real migrations.

When the capability is enabled, the browser's bilingual credit badge distinguishes the initial bounded read
from an unavailable result instead of presenting a normal in-flight request as a failure. It marks initial
loads and background refreshes with `aria-busy`; a refresh may retain the last valid aggregate while pending,
but an error clears that value and shows the unavailable state. These display states never authorize a job;
the Worker independently enforces the current owner entitlement and aggregate when creating one.

Job creation can race the last displayed aggregate. A server `INSUFFICIENT_CREDITS` result therefore uses a
dedicated safe bilingual explanation rather than a generic generation failure or the server message. It is
non-retryable in place, issues no automatic replacement request, and keeps the confirmed private upload so the
owner can return to it without implicit cleanup.

Credit settlement and release have no standalone repository mutation. They are available only through the
guarded job completion, failure, and cancellation operations that commit the matching terminal job state in
the same D1 batch. If completion and failure race, exactly one terminal state and its matching final ledger
event commit; the losing operation fails, and a different owner cannot finalize the job.

`CREDIT_ACCOUNTING_ENABLED=false` is a fail-closed default. Enabling a server-side generation mode
requires an active entitlement, a configured positive `CREDITS_PER_JOB`, and sufficient credits.
The workspace cost cap must also cover the configured job cost. A real-provider job additionally requires
the workspace's manual approval state to be `approved`; onboarding always initializes real-provider and
payment states as `disabled`. There is no browser route for granting credits or changing approval state.

Any future payment-provider implementation remains outside this public Worker behind a generic,
authenticated Service Binding or equivalent server-to-server boundary. The public repository may define
only provider-neutral contracts plus disabled or synthetic adapters. Provider credentials, merchant
mapping, signing logic, hosted-checkout endpoints, and verified webhook ingestion are not part of this
repository or the current MVP.

## 14.2 Local-only synthetic orchestration harness

`pnpm dev:local-ai` builds the web app, prepares isolated Wrangler local state, and serves the canonical
Worker at `http://127.0.0.1:8787`. The harness never accepts a browser-selected owner or a real audio
file. It derives one development owner on the server, creates a bounded deterministic WAV source, and
uses the normal legal, rights, idempotent job creation, credit reservation, Workflow, validation,
private-local-R2, retrieval, settlement, failure, and cancellation paths.

Each local job persists a strict provider-neutral policy for candidate count, quality tier, retry,
concurrency, duration, size, cost-unit, and retention bounds. Synthetic provider attempts use
pseudonymous correlation identifiers and a separate local-only cost ledger. Duplicate, late, or
out-of-order wake-up signals are advisory; the Workflow re-reads D1 state before progressing. Local
cancellation is owner-scoped, releases customer credits once, preserves attempted synthetic cost, and
causes the Workflow to end normally as cancelled. A second synthetic development principal receives a
not-found response when cancelling that job; the original job, attempt, and reserved credits remain
unchanged. The same second principal cannot read the first principal's credit aggregate and receives no
balance fields.

The browser repeats an identical cancellation `POST` for the same validated job ID exactly once only when
the first result is a normalized network error with an unknown outcome. A second network error, caller
abort, API error such as a terminal-state conflict, or an invalid／mismatched success is not resubmitted. A
lost successful response converges safely because an already-cancelled job is replayable, the owner／job
credit-release reference is unique, and the local-attempt transition is idempotent; this recovery does not
weaken the Worker's independent local-capability, owner, or state checks.

The route is fail-closed unless the runtime is explicitly local, the request hostname is loopback, the
mock provider is selected, real generation is disabled, and local D1, R2, Workflow, and credit flags are
enabled. Its synthetic-source endpoint streams at most 4 KiB of `application/json`, validates a strict
fixed-fixture／scenario contract, and returns a strict success payload containing the exact request plus only
the versioned confirmed WAV metadata. The browser compares the fixture, scenario, and idempotency key before
accepting the upload. It serializes the validated request once and repeats that identical `POST` exactly once
only after a normalized network error with an unknown outcome; caller abort, API error, invalid／mismatched
success, and a second network error are not automatically resubmitted. The endpoint returns the same confirmed
upload when one owner replays an idempotency key for the same request; reusing that owner-scoped key for a
different fixture／scenario is a non-retryable
conflict. A deleted source keeps that key tombstoned for its owner, so a late replay is rejected before creating
another upload or private object; simultaneous equivalent requests converge on one confirmed upload and clean
the losing private object, while another owner has an independent scope. Invalid input or a missing capability
creates no upload, local-source row, or additional R2 object. Its owner-bound content route is consumed only
through the authenticated browser API helper;
the resulting synthetic WAV is byte-bounded and converted to a revocable local object URL so direct media
navigation cannot bypass the browser-intent contract. The checked-in deployment flags remain disabled, no
remote resource is selected, and the local test schema is not a production migration.

## 14.3 Data lifecycle and disclosure status

The codebase contains a feature-gated direct-to-private-R2 upload slice, owner-scoped upload and
terminal-job deletion, mock and fal Workflow modes, and an hourly retention handler. The default and
production settings remain `R2_TRANSFER_ENABLED=false`, `JOB_WORKFLOW_ENABLED=false`,
`REAL_GENERATION_ENABLED=false`, and `RETENTION_CLEANUP_ENABLED=false`; no production audio collection
or server-side generation is claimed until a separate staging bucket, exact-origin CORS, signed-URL
expiry, Cron monitoring, and browser checks pass. Cleanup first makes metadata inaccessible, deletes
private R2 objects, then marks object metadata deleted; interrupted deletion remains eligible for the
next run. Bounded unattached-upload candidate selection uses status-scoped cutoff indexes plus an
upload-to-job lookup index, so the scheduled batch does not require full scans of the uploads or jobs tables
while preserving the existing eligibility and ownership predicates. Completed-source selection uses a
completed-state partial covering index to range directly over its cutoff instead of scanning all completed
jobs. Terminal-job selection likewise uses status-scoped partial indexes for completed expiry and
failed／cancelled completion cutoffs, while already-expired jobs use the shared status index. The configured
windows cover unattached uploads and failed artifacts after 24 hours, completed
sources after 72 hours, and outputs after 7 days. External generation remains disabled in production.

Owner-initiated terminal-job deletion is server-idempotent and remains bound to the authenticated owner.
After validating the opaque job ID, the browser may repeat the identical `DELETE` request exactly once only
when the first attempt ends in a normalized network error whose outcome is unknown. A second network error,
caller abort, API error, invalid response, or response bound to a different job is returned without another
automatic request. This recovery rule does not weaken the server's terminal-state, ownership, or private-R2
deletion checks.

Legal acceptance records are metadata evidence, not audio. Their final retention period must be
documented before launch and limited to what is necessary for governing-version proof, security, and
live disputes.

## 14.4 Data recipients, sources, and location claims

- Cloudflare is the current identity, Worker, and D1 processor. Automatic placement and
  location hints do not justify a country- or region-specific residency claim.
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
