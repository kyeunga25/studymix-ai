# Implementation TODO

Status legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- `[!]` blocked

Codex must complete tasks in order and keep this file updated.

## Phase 0 — Repository foundation

- [x] Initialize pnpm workspace.
- [x] Create `apps/web`, `apps/api`, and shared packages.
- [x] Add TypeScript strict mode.
- [x] Add ESLint and formatting.
- [x] Add Vitest.
- [x] Add Playwright.
- [x] Add GitHub Actions for install, typecheck, lint, unit tests, and build.
- [x] Add `.env.example` with placeholders only.
- [x] Add `.gitignore`.
- [x] Add `LICENSE` decision placeholder; do not assume a licence.
- [x] Add root scripts:
  - [x] `dev`
  - [x] `build`
  - [x] `typecheck`
  - [x] `lint`
  - [x] `test`
  - [x] `test:e2e`
- [x] Confirm clean install and CI pass.

### Exit criteria

- [x] `pnpm install` works.
- [x] `pnpm typecheck` passes.
- [x] `pnpm test` passes.
- [x] No Cloudflare or fal credentials required.

## Phase 1 — Contracts and domain model

- [x] Define Zod schemas for uploads.
- [x] Define Zod schemas for presets.
- [x] Define Zod schemas for jobs and outputs.
- [x] Define standard API success/error envelope.
- [x] Implement secure ID generation.
- [x] Implement job state machine.
- [x] Unit-test every allowed transition.
- [x] Unit-test rejected transitions.
- [x] Define provider interface.
- [x] Implement versioned preset package.
- [x] Add Traditional Chinese and English preset text.

### Exit criteria

- [x] Domain packages have no Cloudflare or fal imports.
- [x] State transitions have full unit coverage.
- [x] Public contracts do not contain vendor-specific fields.

## Phase 2 — D1 and repositories

- [ ] Create D1 migrations for:
  - [ ] owners/sessions
  - [ ] uploads
  - [ ] jobs
  - [ ] provider requests
  - [ ] outputs
  - [ ] rights declarations
  - [ ] usage events
- [ ] Add indexes for owner, job status, expiry, and provider request ID.
- [ ] Implement repository functions.
- [ ] Implement idempotent job creation.
- [ ] Implement atomic/guarded state transitions.
- [ ] Add repository integration tests.
- [ ] Add seed data for presets only if presets are stored in D1; otherwise keep presets versioned in code.

### Exit criteria

- [ ] Duplicate idempotency key returns the existing job.
- [ ] Unknown owner cannot read another owner's records.
- [ ] State cannot move through an illegal transition.

## Phase 3 — Web UI shell

- [ ] Create responsive application shell.
- [ ] Add Traditional Chinese and English localization.
- [ ] Implement upload drop zone.
- [ ] Add file format and size client hints.
- [ ] Add rights declaration control.
- [ ] Add preset cards.
- [ ] Add generation confirmation summary.
- [ ] Add pending-job page.
- [ ] Add result comparison with two audio players.
- [ ] Add accessible status announcements.
- [ ] Add error summary and retry guidance.
- [ ] Ensure no provider keys or server configuration enter client build.

### Exit criteria

- [ ] UI can run against a mocked HTTP API.
- [ ] Keyboard-only flow is usable.
- [ ] Rights checkbox is required.

## Phase 4 — R2 upload and download

- [ ] Configure private R2 bucket bindings.
- [ ] Configure separate staging and production buckets.
- [ ] Configure strict CORS for direct upload.
- [ ] Implement `POST /api/uploads`.
- [ ] Generate server-controlled object keys.
- [ ] Generate short-lived `PUT` presigned URLs.
- [ ] Implement upload confirmation.
- [ ] Verify object ownership, existence, and size.
- [ ] Implement upload deletion.
- [ ] Implement short-lived signed output download.
- [ ] Ensure signed URLs are never logged.
- [ ] Add upload/download integration tests.

### Exit criteria

- [ ] Audio does not pass through Worker request memory.
- [ ] Bucket remains private.
- [ ] Expired signed URL fails.
- [ ] User cannot confirm another owner's object.

## Phase 5 — Mock provider and Workflow

- [ ] Implement mock provider.
- [ ] Configure Workflow binding.
- [ ] Implement one Workflow instance per job.
- [ ] Add explicit idempotent steps:
  - [ ] validate
  - [ ] resolve preset
  - [ ] submit candidate requests
  - [ ] wait for completion
  - [ ] ingest outputs
  - [ ] complete job
  - [ ] record usage
- [ ] Simulate latency and retryable failure.
- [ ] Return two deterministic fixture candidates.
- [ ] Implement job polling endpoint.
- [ ] Implement job cancellation metadata.
- [ ] Add Workflow tests where supported.
- [ ] Add end-to-end mock-provider test.

### Exit criteria

- [ ] Full user journey works without fal.
- [ ] Retry of a step does not duplicate candidate records.
- [ ] Duplicate job submission does not start a second billable flow.

## Phase 6 — fal provider adapter

- [ ] Install current supported fal client package only in provider package/API app.
- [ ] Read the current official audio-to-audio schema before implementation.
- [ ] Implement fal request mapper.
- [ ] Keep `FAL_KEY` as a Worker secret.
- [ ] Submit through queue API.
- [ ] Persist provider request ID immediately.
- [ ] Implement status polling.
- [ ] Implement result retrieval.
- [ ] Add provider timeout and bounded retry.
- [ ] Add contract tests using a fake fal HTTP server or mocked client.
- [ ] Do not call paid inference in CI.
- [ ] Add `GENERATION_PROVIDER=mock|fal`.
- [ ] Add `REAL_GENERATION_ENABLED` kill switch.
- [ ] Add daily and per-owner caps.
- [ ] Record estimated cost.

### Exit criteria

- [ ] Switching provider requires configuration only.
- [ ] fal-specific objects do not leak into public API.
- [ ] Paid requests cannot happen when kill switch is false.
- [ ] A real staging request can complete end to end.

## Phase 7 — Webhook and output ingestion

- [ ] Implement fal webhook route.
- [ ] Verify callback using current provider-supported mechanism.
- [ ] If verification is insufficient, re-fetch provider status/result.
- [ ] Make duplicate callback safe.
- [ ] Reject unknown provider request IDs.
- [ ] Stream provider output into R2.
- [ ] Enforce timeout and maximum bytes.
- [ ] Validate content type and non-empty output.
- [ ] Avoid unbounded `response.arrayBuffer()` or `response.text()`.
- [ ] Store minimal provider metadata.
- [ ] Mark candidate and job states correctly.
- [ ] Add duplicate-webhook tests.
- [ ] Add malicious/invalid-output tests.

### Exit criteria

- [ ] Output is served only from private R2.
- [ ] Provider output URL is not persisted as the user-facing URL.
- [ ] A callback cannot attach an output to an unrelated job.

## Phase 8 — Abuse, privacy, and cleanup

- [ ] Integrate Turnstile for real-provider job creation.
- [ ] Add per-owner daily quota.
- [ ] Add active-job limit.
- [ ] Add upload-size limit.
- [ ] Add configurable budget cap.
- [ ] Add delete-job endpoint.
- [ ] Add scheduled cleanup for expired uploads and outputs.
- [ ] Make cleanup idempotent.
- [ ] Add retention notice.
- [ ] Add privacy notice draft.
- [ ] Add acceptable-use notice draft.
- [ ] Add legal-review TODO for Hong Kong public launch.
- [ ] Confirm logs contain no signed URLs or filenames.
- [ ] Add structured security tests for ownership checks.

### Exit criteria

- [ ] Expired objects are deleted.
- [ ] Metadata reflects deletion.
- [ ] User can delete their own job.
- [ ] User cannot delete another owner's job.
- [ ] Real generation requires abuse checks.

## Phase 9 — Observability and beta feedback

- [ ] Enable Worker observability with structured logs.
- [ ] Add request IDs.
- [ ] Add job lifecycle events.
- [ ] Add provider latency metrics.
- [ ] Add cost-estimate metrics.
- [ ] Add preset success metrics.
- [ ] Add simple private feedback form.
- [ ] Capture selected candidate.
- [ ] Add admin-safe metadata view without direct audio access.
- [ ] Document operational runbook.
- [ ] Document provider outage procedure.
- [ ] Document budget kill-switch procedure.

### Exit criteria

- [ ] Failed job can be diagnosed without accessing user audio.
- [ ] Cost and success rate can be computed.
- [ ] Provider can be disabled immediately.

## Phase 10 — Release readiness

- [ ] Complete threat review.
- [ ] Review Cloudflare configuration against current docs.
- [ ] Run `wrangler types`; remove handwritten binding types.
- [ ] Run typecheck, lint, unit, integration, and E2E tests.
- [ ] Verify staging and production resource separation.
- [ ] Verify secrets are not in repository history.
- [ ] Verify CORS.
- [ ] Verify CSP and security headers.
- [ ] Verify accessibility.
- [ ] Verify retention jobs.
- [ ] Verify rights declaration.
- [ ] Verify output-quality disclaimer.
- [ ] Run authorized audio benchmark.
- [ ] Record go/no-go decision.

## Post-MVP backlog

- [ ] Authenticated accounts.
- [ ] Credit payments.
- [ ] 60-second preview then full-track upgrade.
- [ ] Email completion notifications.
- [ ] Batch playlist processing.
- [ ] CPU media validation container using FFmpeg/ffprobe.
- [ ] Stem separation.
- [ ] Symbolic piano/music-box pipeline.
- [ ] Self-hosted ACE-Step provider.
- [ ] Provider routing and fallback.
- [ ] User-controlled immediate source deletion after ingestion.
