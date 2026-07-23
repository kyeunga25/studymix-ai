# Codex Build Prompt

Copy the prompt below into Codex at the root of a new or existing repository.

---

You are the lead engineer for a cloud-native SaaS MVP called **StudyMix AI**.

The product lets a user upload an audio recording that they own or are authorized to process, select one of three study-friendly instrumental presets, asynchronously generate two audio-to-audio candidates, preview them, and download the preferred result before automatic expiry.

## First action

Read these files in full before changing code:

1. `AGENTS.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. `docs/STRATEGY.md`
5. `docs/TODO.md`
6. Existing repository files

Treat them as the product and engineering specification.

## Build objective

Implement the MVP in ordered vertical slices using:

- pnpm workspaces
- React + Vite + TypeScript frontend
- Cloudflare Workers API
- Hono
- Zod
- Cloudflare D1
- Private Cloudflare R2
- Cloudflare Workflows
- A replaceable `MusicGenerationProvider`
- Mock provider for local development and CI
- fal.ai ACE-Step audio-to-audio as the first real provider
- Vitest
- Playwright
- GitHub Actions
- Wrangler JSONC configuration

Do not substitute another platform or architecture unless a documented blocker proves the specified design impossible.

## Critical implementation constraints

- Never expose `FAL_KEY` to the browser.
- Never commit secrets.
- Never proxy complete user audio uploads through Worker memory.
- Use direct browser-to-R2 upload through short-lived presigned `PUT` URLs.
- Keep R2 private.
- Use short-lived signed `GET` URLs for downloads.
- Treat signed URLs as secrets and never log them.
- Require a versioned rights declaration before a real generation request.
- Do not permit arbitrary user-supplied remote audio URLs.
- Do not add arbitrary prompts or artist imitation.
- Use one Workflow instance per generation job.
- Make Workflow steps and webhooks idempotent.
- Use a strict job state machine.
- Generate two candidates for each MVP job.
- Keep vendor-specific details inside the fal adapter.
- The whole application must run locally with the mock provider and no paid credentials.
- Automated tests and CI must never call paid inference.
- Use strict TypeScript and generated Wrangler binding types.
- Validate all external input with Zod.
- Stream provider audio output to R2; do not use an unbounded full-buffer read.
- Enforce ownership on every upload, job, output, download, and delete route.
- Add configurable kill switches, quotas, and retention.
- Do not promise that generated output exactly preserves every note.

## Required repository shape

Use or migrate toward:

```text
apps/
  web/
  api/
packages/
  contracts/
  core/
  providers/
  presets/
  test-fixtures/
docs/
AGENTS.md
README.md
```

## Execution plan

Work through `docs/TODO.md` in order.

Begin with **Phase 0** and continue only when the phase exit criteria pass. Prefer a working vertical slice over broad unfinished scaffolding.

For every phase:

1. Inspect existing code.
2. Explain the specific implementation plan briefly.
3. Implement the smallest coherent change set.
4. Add tests.
5. Run the relevant commands.
6. Fix failures.
7. Update `docs/TODO.md`.
8. Report:
   - files changed
   - commands run
   - test results
   - assumptions
   - unresolved risks
   - next phase

Do not falsely mark tasks complete.

## Provider design

Create this conceptual interface, adapting exact types as needed:

```ts
interface MusicGenerationProvider {
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

Only the fal adapter may import the current fal client.

Before writing the fal adapter, retrieve and read the current official fal.ai ACE-Step audio-to-audio API documentation. Confirm the current package, queue API, input schema, output schema, webhook capabilities, and authentication method. Do not implement from memory.

Map the v1 style presets to provider parameters:

- Soft Piano
- Music Box
- Lo-fi Study

Use instrumental output and remix/audio-to-audio behavior. Keep prompts versioned and testable.

## Cloudflare requirements

Before writing Cloudflare-specific APIs or configuration, retrieve current official Cloudflare documentation for:

- Workers best practices
- R2 presigned URLs and CORS
- Workflows rules and current API
- D1
- Wrangler configuration and generated types

Use bindings rather than Cloudflare REST APIs inside Workers.

Use `wrangler.jsonc`, current compatibility date for a new project, `nodejs_compat` when required, and structured observability. Keep secrets out of config.

## Initial deliverable

First inspect the repository and produce a brief gap analysis against Phase 0. Then implement Phase 0 completely.

Do not attempt real fal inference in the first change set. The first milestone must install, typecheck, test, and build without any Cloudflare account or paid API key.

## Stop conditions

Stop and clearly report a blocker instead of inventing behavior when:

- Current official API documentation contradicts the specification.
- Required Cloudflare functionality is unavailable in the configured account.
- A real-provider webhook cannot be authenticated strongly enough.
- A step would require committing or exposing a secret.
- A paid API call would occur during tests.
- A destructive migration is required without explicit approval.

When blocked, preserve the mock-provider vertical slice and propose the smallest safe alternative.

Start now by reading the specification files and inspecting the repository.
