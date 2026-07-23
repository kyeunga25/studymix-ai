# AGENTS.md

## Mission

Build a secure, testable cloud-native MVP for private audio restyling. Follow `docs/PRD.md`, `docs/ARCHITECTURE.md`, and `docs/TODO.md`.

## Authoritative order

When instructions conflict, use:

1. Explicit user instruction.
2. `docs/PRD.md`.
3. `docs/ARCHITECTURE.md`.
4. `docs/TODO.md`.
5. Existing code and tests.

Do not silently change product scope. Record material architecture changes in an ADR or a clearly named section in the pull request description.

## Non-negotiable constraints

- Cloudflare-first architecture.
- Browser uploads directly to private R2.
- No large audio proxying through the Worker.
- D1 is the MVP metadata database.
- Cloudflare Workflows orchestrates long-running jobs.
- AI access uses a provider interface.
- Mock provider must always work without paid credentials.
- fal is the initial real provider.
- Never expose or log `FAL_KEY`.
- Never commit secrets.
- No paid API calls in automated tests or CI.
- No arbitrary remote URL ingestion from users.
- No public result pages.
- No artist-name prompt feature.
- Rights declaration required before real generation.
- Outputs expire and are private.
- Use strict TypeScript.
- Validate all external input with Zod.
- Use generated Wrangler binding types.
- Do not hand-write an unverified `Env` interface.
- No `any`, unsafe double casts, or ignored type errors.
- Every Promise must be awaited, returned, explicitly voided, or passed to `ctx.waitUntil`.
- Do not keep request-specific mutable state in module globals.
- Stream unbounded responses; do not buffer complete audio into memory.
- Do not use Cloudflare REST APIs from a Worker when a binding exists.
- Do not use `Math.random()` for IDs or security tokens.

## Working method

For each phase:

1. Read the relevant documents.
2. Inspect existing code before editing.
3. State assumptions in the commit or task summary.
4. Implement the smallest vertical slice.
5. Add or update tests.
6. Run typecheck, lint, and tests.
7. Update `docs/TODO.md`.
8. Summarize changed files, commands run, and remaining risks.

Do not mark a TODO complete unless its acceptance criteria are demonstrably satisfied.

## External APIs

Before implementing or changing Cloudflare or fal integrations:

- Read current official documentation.
- Confirm current package names and schemas.
- Do not assume an endpoint or field from memory.
- Isolate vendor mapping in the provider adapter.
- Add a contract test around the mapping.

## Database rules

- All user-owned rows include an owner ID.
- Every read, update, and delete enforces ownership.
- Use stable IDs generated on the server.
- Idempotency keys are unique within the correct owner/scope.
- State transitions are guarded.
- Migrations are additive and reviewable.
- Never delete user metadata accidentally during deployment.

## Security review checklist

Before completing a route:

- Authentication/session resolved?
- Ownership checked?
- Zod validation passed?
- Rate/usage limit considered?
- Object key server-controlled?
- Secret protected?
- URL or callback verified?
- Error safe to expose?
- Sensitive fields absent from logs?
- Operation idempotent?
- Test covers another-owner access?

## Definition of done

A task is done only when:

- Code builds.
- Typecheck passes.
- Relevant tests pass.
- No secret is introduced.
- Documentation is updated.
- Failure paths are handled.
- The implementation remains usable with the mock provider.
