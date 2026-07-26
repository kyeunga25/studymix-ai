# StudyMix AI — 私人音訊風格重塑 / Private Audio Restyling

StudyMix AI 是一個 Cloudflare-first、雙語及安全優先的音訊風格重塑應用。使用者只可處理自己擁有或已獲授權的錄音。

StudyMix AI is a bilingual, security-first, Cloudflare-native application for restyling audio that the user owns or is authorized to process.

公開首頁提供產品、運作方式及私隱安全概覽；AI 工作區位於 `/app`，只限受邀測試者經 Cloudflare Access 登入。沒有公開註冊，正式音訊上載及外部生成保持停用。公開程式碼可在不使用付費憑證的情況下，以本機 mock 或預設關閉的 Cloudflare Workflow 合成音調展示完整介面狀態。

## Target MVP outcome

The product contract supports an approved user who can:

1. Upload an audio file directly to private Cloudflare R2 storage.
2. Confirm that they own or are authorized to process the recording.
3. Select one of three style presets:
   - Soft Piano
   - Music Box
   - Lo-fi Study
4. Start an asynchronous generation job.
5. Receive two generated candidates.
6. Preview the candidates and download the preferred result.
7. Have source and output files deleted automatically after the retention period.

The verified implementation uses a provider adapter with:

- `mock` provider for local development and automated tests.

No external provider adapter is enabled in the current release.

## Recommended stack

- Monorepo: pnpm workspaces
- Frontend: React + Vite + TypeScript
- API: Cloudflare Workers + Hono
- Validation: Zod
- Database: Cloudflare D1
- Object storage: private Cloudflare R2
- Long-running orchestration: Cloudflare Workflows
- Abuse prevention: Cloudflare Turnstile and server-side quotas
- Authentication: Cloudflare Access with Worker-side JWT verification
- AI provider: fal.ai ACE-Step audio-to-audio
- Testing: Vitest + Playwright, including browser end-to-end coverage in CI
- CI/CD: GitHub Actions validation + Cloudflare Workers Builds deployment
- Package manager: pnpm

## Repository layout

```text
apps/
  web/                    React frontend
  api/                    Worker API and Workflow
packages/
  contracts/              Shared Zod schemas and API types
  core/                   Domain logic and state transitions
  providers/              Music generation provider adapters
  presets/                Versioned style presets
  test-fixtures/           Non-copyrighted test assets and metadata
docs/
  PRD.md
  ARCHITECTURE.md
  TODO.md
  CLOUDFLARE_ACCESS.md
  LEGAL_AND_DATA_USE.md
AGENTS.md
README.md
```

## Core design rules

- Never expose the fal API key to the browser.
- Never proxy large uploads through the Worker.
- Use presigned R2 URLs for browser uploads and downloads.
- Keep R2 buckets private.
- Treat all presigned URLs as short-lived bearer credentials.
- Do not hold a request open while AI generation runs.
- Every job must be idempotent and recoverable.
- Use a provider interface so the AI vendor can be replaced.
- The repository must run without paid services by using the mock provider.
- Do not store or log user audio, signed URLs, API keys, or full webhook payloads.
- Require an explicit rights declaration before generation.
- Require exact current Terms, AUP, and AI/output acceptance on the server before generation.
- Do not launch public sharing, discovery, or remix feeds in the MVP.
- Do not scrape or ingest tracks from official/third-party websites, public APIs, or remote URLs.
- Do not describe planned retention, deletion, provider privacy, or data-location controls as operational
  before they are tested and verified.

## Read next

1. `docs/PRD.md`
2. `docs/ARCHITECTURE.md`
3. `docs/TODO.md`
4. `docs/CLOUDFLARE_ACCESS.md`
5. `docs/LEGAL_AND_DATA_USE.md`
6. `AGENTS.md`

## Local development

Requirements:

- Node.js 22.12 or newer
- pnpm 11 or newer

```bash
pnpm install --frozen-lockfile
pnpm cf-typegen
pnpm dev
```

The public product page runs at `http://localhost:5173/`, the invited-tester workspace at
`http://localhost:5173/app`, and the Worker API at
`http://localhost:8787`. Local Wrangler development uses one fixed development owner and the mock
provider; no Cloudflare account, fal key, or paid API is required. The development identity is enabled
only by the local `dev` script and is ignored by production and staging authentication. `pnpm dev`
applies pending migrations to the ignored local D1 state before starting both applications.

Vite's local development server also supplies a development-only mock HTTP job API. It lets the UI move
through pending and completed states with two generated local WAV fixtures, without R2, Workflows, fal,
or paid credentials. Open `http://localhost:5173/?mockScenario=failed` to verify retry guidance, or use
`mockScenario=malformed` to verify invalid-response handling. This mock server is excluded from the
production build; production upload and generation remain disabled until their security controls are verified.

The Worker also contains a separate feature-gated mock job API and Cloudflare Workflow. When explicitly
enabled in an isolated test environment with private R2, it validates the owner, current legal acceptance,
confirmed upload, rights declaration, preset, idempotency key, and active-job limit before producing two
small synthetic WAV tones. It does not send the source to an external provider or make a paid API call.
Workflow integration tests exercise retries, D1 state, private R2 output metadata, and cross-owner denial.
Both `R2_TRANSFER_ENABLED` and `JOB_WORKFLOW_ENABLED` remain `false` by default.

The provider package also contains an offline-tested fal ACE-Step audio-to-audio adapter. It uses the
asynchronous queue, validates external responses, disables provider JSON payload storage, requests a
bounded output lifetime, and returns only allowlisted result metadata. The feature-gated Workflow can
select this adapter, issue a short-lived private source URL, use verified fal callbacks as wake-up
signals, poll the queue API as the source of truth, and persist only minimal request metadata. Callback
verification uses fal's rotating Ed25519 public keys, the exact raw body, a bounded timestamp window,
the configured fal user, and a known provider request. Complete callback payloads are discarded. It is
disabled by default; local development and CI continue to use the credential-free mock provider and
never make paid calls.

The Worker includes a separately tested provider-output ingestion boundary. It accepts only expected
HTTPS provider hosts and audio media types, refuses redirects and encoded or unbounded bodies, and streams
a fixed-length response directly into private R2 with an idempotent conditional write. Real provider
generation uses this boundary before marking an output ready. The real-provider path remains disabled
until the staging, legal, abuse-control, and deletion gates are verified.

The production build uses one Cloudflare Worker: Vite output is served through Workers Static Assets,
while `/api/*` is routed to the Hono Worker. The product overview, legal pages, `/health`, and
`/legal/documents.json` are public. Cloudflare Access and Worker-side JWT verification protect `/app*`
and user-facing `/api/*` routes. The exact `/api/webhooks/fal` path is separately authenticated with the
provider signature and cannot create an owner. Build it from the repository root:

```bash
pnpm build
```

The checked-in Wrangler file contains placeholders only and is intentionally not a deployable production
configuration. `pnpm deploy:cloudflare` generates an ignored deployment file from the protected
`DEPLOY_WORKER_NAME`, `DEPLOY_D1_NAME`, and `DEPLOY_D1_ID` build settings. The optional protected
`DEPLOY_R2_BUCKET` setting adds the private R2 binding only for an approved staging deployment; optional
`DEPLOY_WORKFLOW_NAME` does the same for the Workflow binding. The optional protected
`DEPLOY_RATE_LIMIT_NAMESPACE_ID` setting adds the Cloudflare Rate Limiting binding required by real
generation. Runtime
Access, R2 signing, and legal settings stay in Cloudflare and are retained during deployment. Follow
[`docs/CLOUDFLARE_ACCESS.md`](docs/CLOUDFLARE_ACCESS.md); never commit Cloudflare account IDs, D1 IDs,
Access identifiers, actual resource names, contact details, or deployment tokens.

After preparing the ignored deployment config, verify the active deployment without printing its Worker,
database, bucket, Workflow, hostname, account identifiers, runtime values, or secret values:

```bash
DEPLOY_WORKER_NAME="PRIVATE_VALUE" \
DEPLOY_PUBLIC_URL="https://PRIVATE_HOSTNAME" \
DEPLOY_EXPECT_ENV=production \
pnpm deploy:verify
```

The command returns only boolean readiness gates and migration counts. A non-zero exit means the public
surface is not yet demonstrably ready; private mock and real-provider readiness are reported separately.

Workers Builds treats pushes to the configured production branch as production builds. Other branches
remain preview-only when non-production builds are enabled, so a successful preview check must not be
described as an active production deployment.

Validation commands:

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

The active relaxed, study-focused UI direction and browser QA screenshots are under
`docs/design/`.

## Current implementation status

The repository currently includes:

- pnpm workspaces for the React/Vite web app, Hono Worker API, and shared packages.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, and GitHub Actions.
- A bilingual public product overview with an explicit closed-beta status and no registration flow.
- A separate `/app` workspace that verifies the invited Access session before exposing application UI.
- Generated Wrangler binding types and a credential-free Worker dry-run build.
- An interactive bilingual upload UI shell with pending, result-comparison, and safe retry states backed
  by a development-only mock HTTP API.
- Strict public Zod contracts for uploads, presets, jobs, outputs, and API envelopes.
- Cryptographically secure resource IDs and an exhaustive job state machine.
- A vendor-neutral music-generation provider interface.
- Versioned English and Traditional Chinese preset definitions.
- Additive D1 migrations and owner-scoped repositories for all MVP metadata.
- Cloudflare Access JWT authentication, a server-derived owner identity, and cross-owner denial tests.
- Versioned bilingual legal pages, owner-scoped D1 acceptance evidence, bounded legal APIs, and a
  fail-closed production contact requirement.
- Identifier-free deployment scripts for Cloudflare Workers Builds and one-time authenticated Wrangler
  deployment.
- A feature-gated private R2 transfer slice with server-controlled keys, short-lived conditional PUT
  signatures, direct browser transfer, R2 metadata confirmation, owner-negative tests, explicit upload
  deletion, active-upload limits, and short-lived ready-output download signatures.
- A feature-gated owner-scoped job API and Cloudflare Workflow that uses the credential-free mock provider
  to create two bounded synthetic WAV candidates in private R2, with idempotent metadata updates, active-job
  limits, persisted rights evidence, private playback URLs, and Workflow integration tests.
- A default-off fal Workflow path with strict runtime configuration, private-source validation and signing,
  at-most-once submission steps, signed callback wake-ups with queue polling fallback, safe provider-error
  mapping, streamed private-R2 output ingestion, nullable provider metadata, and offline tests that make no
  paid requests.
- One private browser flow for mock or real capability modes: direct R2 upload, bounded same-status job
  polling, two private playback/download links, safe bilingual failures, and terminal data deletion.
- A D1 rolling owner quota plus a Cloudflare Rate Limiting binding keyed by owner and hashed connecting IP
  before a real-provider job can create metadata.
- A feature-gated retention path with owner-scoped terminal-job deletion, hourly Cron handling, retry-safe
  private R2 purging, 24-hour unattached/failed-artifact cleanup, 72-hour completed-source cleanup, and
  7-day output expiry.

Production R2 transfer and both server-side Workflow modes remain disabled until private staging checks
pass. External generation and provider callbacks remain disabled in production. Production retention
cleanup also stays off until its staging Cron, retry, and monitoring checks pass. See
[`docs/TODO.md`](docs/TODO.md) for the current verified status without internal planning material.
