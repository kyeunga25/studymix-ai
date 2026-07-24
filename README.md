# StudyMix AI — 私人音訊風格重塑 / Private Audio Restyling

StudyMix AI 是一個 Cloudflare-first、雙語及安全優先的音訊風格重塑應用。使用者只可處理自己擁有或已獲授權的錄音。

StudyMix AI is a bilingual, security-first, Cloudflare-native application for restyling audio that the user owns or is authorized to process.

目前公開程式碼可在不使用付費憑證的情況下展示完整介面狀態；真實音訊上傳及外部生成保持停用。

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

The first implementation uses a provider adapter with:

- `mock` provider for local development and automated tests.
- `fal` provider for ACE-Step audio-to-audio generation.

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
- Testing: Vitest + Playwright
- CI/CD: GitHub Actions + Wrangler
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

The web application runs at `http://localhost:5173` and the Worker API at
`http://localhost:8787`. Local Wrangler development uses one fixed development owner and the mock
provider; no Cloudflare account, fal key, or paid API is required. The development identity is enabled
only by the local `dev` script and is ignored by production and staging authentication. `pnpm dev`
applies pending migrations to the ignored local D1 state before starting both applications.

Vite's local development server also supplies a development-only mock HTTP job API. It lets the UI move
through pending and completed states with two generated local WAV fixtures, without R2, Workflows, fal,
or paid credentials. Open `http://localhost:5173/?mockScenario=failed` to verify retry guidance, or use
`mockScenario=malformed` to verify invalid-response handling. This mock server is excluded from the
production build; production upload and generation remain disabled until their security controls are verified.

The production build uses one Cloudflare Worker: Vite output is served through Workers Static Assets,
while `/api/*` is routed to the Hono Worker. Build it from the repository root:

```bash
pnpm build
```

The checked-in Wrangler file contains placeholders only and is intentionally not a deployable production
configuration. Follow [`docs/CLOUDFLARE_ACCESS.md`](docs/CLOUDFLARE_ACCESS.md) with an ignored local or
CI deployment configuration. Never commit Cloudflare account IDs, D1 IDs, Access identifiers, actual
resource names, or contact details.

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

Direct R2 transfer, external generation, deletion/cleanup, and provider callbacks remain disabled. See
[`docs/TODO.md`](docs/TODO.md) for the current verified status without internal planning material.
