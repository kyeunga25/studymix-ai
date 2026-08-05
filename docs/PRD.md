# Product Requirements Document

## 1. Product summary

StudyMix AI is a cloud-native audio restyling SaaS. It allows a user to upload an audio recording that they own or are authorized to process, then generate study-friendly instrumental reinterpretations in a consistent style.

The application is designed for private, authorized audio processing with clear ownership boundaries,
recoverable asynchronous jobs, and replaceable generation providers.

## 2. Problem

People often enjoy songs from different artists, games, animation projects, and personal music collections, but the originals may be distracting during study or work because of vocals, loud dynamics, or inconsistent styles.

Manually commissioning or producing piano, music-box, and lo-fi arrangements is expensive and slow. Existing text-to-music tools generally create new music rather than a recognizable reinterpretation of a user-provided track.

## 3. Target users

### Primary

- Independent musicians and small creators processing their own recordings.
- Users processing public-domain, royalty-free, Creative Commons, or otherwise licensed recordings.
- Content creators needing a private instrumental study version of authorized material.

### Excluded from initial positioning

- Public distribution of unauthorized commercial-song remixes.
- Artist imitation services.
- A public remix marketplace.
- A streaming replacement or music piracy tool.
- Training models on user uploads.

## 4. MVP user story

> As a user with the necessary rights, I upload one audio track, select a study-friendly style, generate two candidates, listen to both, and download the version I prefer.

## 5. Scope

### Included

- Upload MP3, WAV, M4A, AAC, or OGG.
- Private direct-to-R2 upload.
- File metadata validation.
- Rights declaration checkbox.
- Three style presets.
- One asynchronous generation job with two candidates.
- Job status and retry-safe progress.
- Candidate audio player.
- Download through a short-lived signed URL.
- Automatic expiry and deletion.
- Mock generation provider.
- fal.ai provider adapter.
- Basic quota and abuse controls.
- Owner-scoped private-beta usage credits with atomic reservation, settlement, and release.
- Operational logs without sensitive audio data.
- English and Traditional Chinese UI strings.
- Public bilingual product overview with no registration or user-content surface.
- Authenticated private-beta access through Cloudflare Access.
- Versioned Terms, Privacy Notice, Acceptable Use Policy, and AI/output notice.
- Server-side current-document acceptance before real generation.

### Explicitly excluded

- Playlists and batch uploads.
- Stem separation.
- MIDI extraction.
- User-written arbitrary prompts.
- Artist-name style prompts.
- Public result pages.
- Social features.
- Permanent cloud library.
- Collaborative editing.
- Mobile native applications.
- Self-hosted GPU inference.
- Formal automated musical-quality scoring.
- Audio mastering beyond basic output validation.
- Public pricing, checkout, subscriptions, top-ups, or a browser-to-payment-provider integration.

## 6. Functional requirements

### FR-1: Create upload

The API creates an upload record and returns:

- `uploadId`
- `objectKey`
- A short-lived R2 `PUT` presigned URL
- Allowed content types
- Maximum file size
- Expiry time

The browser uploads directly to R2.

### FR-2: Confirm upload

After upload, the client calls a confirmation endpoint.

The server checks:

- The upload record exists.
- The object key belongs to the current user/session.
- The object exists in R2.
- The object size is within the configured limit.
- The declared content type is accepted.
- The upload has not expired.

The server must not trust client-supplied object keys or sizes.

### FR-3: Legal acceptance and rights declaration

Before creating a generation job, the server must verify that the authenticated owner has accepted the
current Terms of Use, Acceptable Use Policy, and AI and Output Notice. The Privacy Notice is presented
and acknowledged but is not mislabeled as optional consent for processing necessary to provide the
service. A stale or incomplete document set blocks job creation.

The user must also affirm for that job and upload:

> I own this recording or have permission to upload, process, and create an adapted version of it.

Store:

- Declaration version
- Timestamp
- User/session ID
- Job ID
- Source upload ID

Do not store unnecessary identifying information.

Legal acceptance evidence stores only the owner ID derived from verified Access claims, document ID,
document version, and server timestamp. A browser cannot supply the owner identity or acceptance time.

### FR-4: Style selection

MVP presets:

#### Soft Piano

Goal: calm instrumental solo-piano reinterpretation with a recognizable central melody and restrained dynamics.

#### Music Box

Goal: delicate music-box reinterpretation with sparse accompaniment and no vocals.

#### Lo-fi Study

Goal: relaxed instrumental lo-fi reinterpretation with soft drums, warm keys, limited high-frequency energy, and no vocals.

Presets are versioned data, not hardcoded UI copy.

### FR-5: Start generation

A job request includes:

- Confirmed upload ID
- Preset ID and preset version
- Candidate count: fixed at 2 for MVP
- Rights declaration version
- Optional deterministic client request key

The API:

1. Validates quota.
2. Creates one job record.
3. Starts one Workflow instance.
4. Returns `202 Accepted` and the job ID.

Repeated requests with the same idempotency key must not create duplicate provider submissions.

### FR-6: Provider submission

The Workflow generates a short-lived input URL and submits candidate requests through the configured provider adapter.

For the fal adapter:

- Endpoint: ACE-Step audio-to-audio
- Edit mode: remix
- Input audio: short-lived signed source URL
- Target tags: generated from the selected preset
- Instrumental output requested
- Provider request ID stored
- FAL key kept only as a Worker secret

Do not make browser-to-fal calls.

### FR-7: Job progress

Supported public job states:

```text
created
validating
queued
generating
processing_output
completed
failed
expired
cancelled
```

Internal state may be more detailed.

The client polls `GET /api/jobs/:jobId` with bounded backoff. Server-Sent Events are optional and not required for MVP.

### FR-8: Provider completion

Support both:

- Provider webhook completion.
- Workflow polling fallback.

Webhook handling must:

- Authenticate or verify the callback using the strongest mechanism supported by the provider.
- Be idempotent.
- Reject unknown request IDs.
- Never log secret query parameters or complete payloads.
- Return quickly.
- Store only necessary provider metadata.

If strong webhook verification is not available, treat webhook data as a signal and verify the result using the provider API before accepting it.

### FR-9: Output ingestion

For each provider output:

1. Validate the returned URL and expected provider domain or retrieval mechanism.
2. Fetch with timeouts and maximum-size protections.
3. Stream the output into private R2.
4. Record object metadata.
5. Mark the candidate ready.
6. Delete or stop referencing third-party output URLs.

Never load an unbounded audio response fully into Worker memory.

### FR-10: Preview and download

The user can:

- Play both candidates.
- See preset name, generation status, duration when known, and expiry.
- Request a short-lived signed `GET` URL.
- Download an output before expiry.

### FR-11: Retention

Default MVP policy:

- Abandoned uploads: delete after 24 hours.
- Source audio: delete no later than 72 hours after job completion.
- Generated outputs: delete after 7 days.
- Failed-job artifacts: delete after 24 hours.
- Metadata required for abuse prevention and legal evidence may be retained longer without retaining audio.

Retention values must be configurable.

### FR-12: Failure handling

User-visible failure categories:

- Invalid or unsupported file.
- Upload expired.
- Quota exceeded.
- Provider rejected request.
- Provider timeout.
- Provider generation failed.
- Output could not be validated.
- Internal temporary error.

A failed job must record whether a safe retry is permitted.

### FR-13: Private-beta usage credits

Server-side generation requires an active owner entitlement and enough private-beta usage credits.
Credits are an abuse and spend-control unit for the invited beta; they are not a published price or a
claim about the final commercial unit.

The API must:

1. Reserve the configured job cost atomically with first-time job creation.
2. Return the existing job without creating another reservation for an idempotent replay.
3. Settle the reservation exactly once after successful private output processing.
4. Release the reservation exactly once when the Workflow reaches a terminal failure.
5. Keep grant, reserve, settle, and release events owner-scoped and append-only.
6. Expose only the authenticated owner's aggregate available, reserved, and settled credit totals.

There is no public grant, checkout, payment, or subscription route in the MVP. Beta entitlements and
credit grants are provisioned through an approved operational process outside the browser application.

### FR-14: Invited owner workspace

Production and staging access requires both a valid interactive Cloudflare Access application token and
an approved D1 invitation. The invitation stores only a keyed one-way login-identity hash. Its first valid
login creates exactly one active owner, active default workspace, active owner membership, manual AI
approval controls, active private-beta entitlement, and idempotent bounded credit grant.

Every private API and `/app` Static Assets request must recheck active owner, membership, and workspace
state. The server selects the default workspace; malformed or different client workspace assertions are
denied. The session API returns status, role, permissions, approval state, and capability booleans without
returning login identity, owner ID, workspace ID, or resource mappings. There is no public registration,
browser onboarding, browser credit grant, or browser approval endpoint.

## 7. Non-functional requirements

### Security

- All buckets private.
- Presigned upload URLs expire quickly.
- Object keys generated using cryptographically secure random IDs.
- Secrets managed using Wrangler secrets.
- Strict CORS.
- Turnstile on job creation.
- Per-IP and per-session quotas.
- No user-controlled remote URL fetches.
- Content Security Policy on the web application.
- Structured error responses without stack traces.
- No request-scoped mutable global state.
- No anonymous production or staging access.
- Worker verifies Access JWT signature, issuer, audience, time claims, and interactive-user claims.
- Owner IDs are server-derived from verified identity and never accepted from client input.
- The exact `/app` and `/api` parents and their deep routes require Access plus active D1 workspace
  membership before API or Static Assets handling.
- Job creation checks the current server-controlled legal versions; client-only checkboxes are not an
  authorization or legal control.
- Production fails closed if the legal contact or current-document manifest is invalid.

### Privacy

- No training on uploads.
- No indexing or public exposure of the private workspace, user metadata, source audio, or outputs.
- No permanent retention by default.
- No audio content in logs.
- Clear retention notice before upload.
- User can request immediate deletion of a completed or failed job.
- Do not promise that a planned deletion or retention control is operational until its route, scheduled
  cleanup, owner-negative tests, and runtime monitoring exist.

### Data and content sources

- Accept audio only from the authenticated user's direct upload; never ingest arbitrary remote URLs.
- Do not scrape or import tracks or personal data from official websites, third-party websites, public
  databases, social platforms, or source APIs.
- Public availability or a public-domain/licence label is not treated as proof of permission.
- Style presets are internal, versioned text. No artist-name prompt feature is allowed.
- Do not claim that every external model training source is identified or licensed for every downstream
  use. Provider provenance, input use, retention, subprocessors, and output terms are launch checks.

### Reliability

- Every Workflow step must be idempotent.
- Provider submissions must use idempotency controls where available.
- Duplicate webhooks must be harmless.
- Job state transitions must be validated.
- The system must recover from Worker restarts and transient provider errors.

### Performance

- API metadata responses target p95 below 500 ms, excluding external services.
- Upload and download transfer directly between the browser and R2.
- UI remains usable while generation is pending.
- Do not promise a fixed generation time.

### Accessibility

- Keyboard-operable upload and audio controls.
- Proper labels and error summaries.
- Status changes announced with ARIA live regions.
- No color-only status communication.
- Traditional Chinese and English text supported.

## 8. Data model

### owners

- `id`
- `kind`
- `auth_issuer`
- `auth_subject_hash`
- `created_at`
- `last_seen_at`
- `status`

### owner_invitations

- `id`
- `login_identity_hash`
- `workspace_id`
- `role`
- `status`
- bounded initial credit and job-cost controls
- claimed owner and timestamps

### workspaces

- `id`
- `status`
- timestamps

### workspace_memberships

- `workspace_id`
- `owner_id`
- `role`
- `status`
- default-workspace marker
- timestamps

### workspace_controls

- `workspace_id`
- manual AI-job approval mode
- maximum job credit cost
- real-provider approval status
- payment approval status
- timestamps

### uploads

- `id`
- `owner_id`
- `object_key`
- `original_filename`
- `declared_content_type`
- `size_bytes`
- `status`
- `created_at`
- `confirmed_at`
- `expires_at`

### jobs

- `id`
- `owner_id`
- `upload_id`
- `preset_id`
- `preset_version`
- `status`
- `idempotency_key`
- `workflow_instance_id`
- `candidate_count`
- `provider`
- `error_code`
- `created_at`
- `updated_at`
- `completed_at`
- `expires_at`

### provider_requests

- `id`
- `job_id`
- `candidate_index`
- `provider`
- `provider_request_id`
- `status`
- `seed`
- `submitted_at`
- `completed_at`
- `error_code`

### outputs

- `id`
- `job_id`
- `candidate_index`
- `object_key`
- `content_type`
- `size_bytes`
- `duration_seconds`
- `status`
- `created_at`
- `expires_at`

### rights_declarations

- `id`
- `job_id`
- `owner_id`
- `declaration_version`
- `accepted_at`

### legal_acceptances

- `owner_id`
- `document_id`
- `document_version`
- `accepted_at`

### usage_events

- `id`
- `owner_id`
- `job_id`
- `event_type`
- `quantity`
- `created_at`

### owner_entitlements

- `owner_id`
- `plan_code`
- `status`
- `created_at`
- `updated_at`

### credit_ledger

- `id`
- `owner_id`
- `job_id` when the event belongs to a generation job
- `event_type`: grant, reserve, settle, or release
- `quantity`
- `reference_key`
- `created_at`

## 9. API outline

```text
GET    /health
GET    /legal/documents.json

GET    /api/session
GET    /api/auth/me (compatibility alias)
GET    /api/legal/documents
GET    /api/legal/acceptances
POST   /api/legal/acceptances

POST   /api/uploads
POST   /api/uploads/:uploadId/confirm
DELETE /api/uploads/:uploadId

GET    /api/presets
GET    /api/credits

POST   /api/jobs
GET    /api/jobs/:jobId
DELETE /api/jobs/:jobId

POST   /api/outputs/:outputId/download
POST   /api/webhooks/fal

GET    /api/health
```

All routes return a consistent envelope:

```json
{
  "data": {},
  "error": null,
  "requestId": "..."
}
```

Error example:

```json
{
  "data": null,
  "error": {
    "code": "UPLOAD_EXPIRED",
    "message": "The upload has expired.",
    "retryable": false
  },
  "requestId": "..."
}
```

## 10. Acceptance criteria

The MVP is accepted when:

1. A clean clone runs locally with the mock provider.
2. A user can upload a non-copyrighted test file directly to R2 in a deployed test environment.
3. The API creates exactly one job for repeated requests sharing an idempotency key.
4. The mock Workflow produces two playable candidates.
5. The fal adapter can be enabled using environment configuration without changing domain code.
6. The fal API key never appears in browser bundles, logs, D1, or repository history.
7. A duplicate webhook does not duplicate outputs or corrupt state.
8. Generated files are stored privately in R2.
9. Download links expire.
10. Cleanup removes expired objects and updates metadata.
11. Unit, integration, and end-to-end tests pass in CI.
12. The user must accept the rights declaration before any real provider request.
13. The UI clearly states that output may not preserve every musical detail.
14. The repository documents how to run locally, deploy staging, and configure production.
15. Production and staging require a valid interactive Access JWT plus active D1 owner/workspace
    membership for `/app`, `/app/*`, `/api`, and user-facing `/api/*`. The exact `/api/webhooks/fal`
    callback is the only provider-authenticated exception and
    requires the strongest current fal signature verification. Public routes expose no owner state,
    audio, signed URLs, or private application data.
16. A generation job cannot be created without an active owner entitlement and sufficient credits;
    repeated requests, Workflow retries, and terminal failures do not duplicate or strand credit events.
17. An uninvited identity, disabled owner, disabled membership, disabled workspace, or cross-workspace
    assertion cannot receive the SPA shell or private API data.
