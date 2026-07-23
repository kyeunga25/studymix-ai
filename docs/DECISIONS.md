# Architecture Decisions

## ADR-001: Cloudflare control plane

**Status:** Accepted for MVP

Use Workers, D1, R2, and Workflows for the web application, metadata, object storage, and orchestration.

**Reason:** It matches the project owner's existing Cloudflare deployment experience and keeps the non-GPU infrastructure low-maintenance.

## ADR-002: External GPU provider

**Status:** Accepted for MVP

Use fal.ai ACE-Step audio-to-audio behind a provider adapter.

**Reason:** It avoids fixed GPU infrastructure and allows the idea to be validated before self-hosting.

## ADR-003: Provider portability

**Status:** Accepted

Domain logic must depend on `MusicGenerationProvider`, not fal-specific contracts.

**Reason:** Model endpoints, pricing, policies, and quality can change.

## ADR-004: Direct R2 transfer

**Status:** Accepted

Use browser-to-R2 upload and signed R2 download.

**Reason:** Large audio files should not be buffered or proxied through Worker request memory.

## ADR-005: Two candidates

**Status:** Accepted for MVP

Generate two candidates for each job.

**Reason:** Audio generation is stochastic. Candidate choice is a simpler quality-control mechanism than building an automated musical judge in the MVP.

## ADR-006: Restricted presets

**Status:** Accepted for MVP

Only Soft Piano, Music Box, and Lo-fi Study are exposed.

**Reason:** Controlled prompts reduce product complexity, abuse risk, and benchmark variance.

## ADR-007: No payments in MVP

**Status:** Accepted

Validate quality and cost before adding billing.

**Reason:** Monetization is premature until output acceptance and failure rates are known.

## ADR-008: Rights-holder positioning

**Status:** Accepted

Position the product for recordings the user owns or is authorized to process.

**Reason:** Model licensing does not grant rights to adapt third-party recordings.
