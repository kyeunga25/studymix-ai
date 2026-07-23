# StudyMix AI — Cloud Music Restyling MVP

> Working title. A cloud-native SaaS that transforms a user-authorized audio track into a consistent study-friendly instrumental style.

## MVP outcome

A user can:

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
- A future `self-hosted` provider for RunPod, Modal, or another GPU service.

## Recommended stack

- Monorepo: pnpm workspaces
- Frontend: React + Vite + TypeScript
- API: Cloudflare Workers + Hono
- Validation: Zod
- Database: Cloudflare D1
- Object storage: private Cloudflare R2
- Long-running orchestration: Cloudflare Workflows
- Abuse prevention: Cloudflare Turnstile and server-side quotas
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
  STRATEGY.md
  TODO.md
  CODEX_PROMPT.md
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
- Do not launch public sharing, discovery, or remix feeds in the MVP.

## Read next

1. `docs/PRD.md`
2. `docs/ARCHITECTURE.md`
3. `docs/TODO.md`
4. `AGENTS.md`
5. `docs/CODEX_PROMPT.md`

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
`http://localhost:8787`. Phase 0 uses only `GENERATION_PROVIDER=mock`; no Cloudflare account,
fal key, or paid API is required.

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

Phase 0 is complete. The repository includes:

- pnpm workspaces for the React/Vite web app, Hono Worker API, and shared packages.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, and GitHub Actions.
- Generated Wrangler binding types and a credential-free Worker dry-run build.
- An interactive bilingual upload UI shell using the mock-only product state.

Contracts, state transitions, D1 repositories, direct R2 transfer, Workflows, and fal integration
remain in their ordered phases in `docs/TODO.md`.
