# MVP Validation and Delivery Strategy

## 1. Strategic objective

Do not begin by building a complete consumer music platform. Build the smallest trustworthy system that can answer:

> Can an external audio-to-audio model repeatedly create a recognizable, pleasant, study-friendly reinterpretation of an authorized source track at an acceptable cost?

The software is secondary to this validation.

## 2. Primary risks

### R1: Musical quality risk — highest

The result may:

- Lose the recognizable melody.
- Retain unwanted vocals.
- Alter the song structure.
- Introduce artifacts.
- Produce inconsistent quality across genres.

Mitigation:

- Generate two candidates.
- Restrict presets.
- Benchmark before launch.
- Display realistic expectations.
- Keep the provider replaceable.

### R2: Copyright and product-positioning risk — highest

A technically successful tool can still be unsuitable as a public SaaS if positioned as an unauthorized commercial-song remix service.

Mitigation:

- Target rights holders and authorized recordings.
- Require rights affirmation.
- No public sharing.
- No built-in commercial-song catalogue.
- No artist imitation.
- Short retention.
- Obtain Hong Kong legal advice before monetized public launch.

### R3: Provider dependency

The endpoint, schema, price, availability, or moderation rules may change.

Mitigation:

- Provider interface.
- Contract tests.
- Feature flag and kill switch.
- Mock provider.
- Persist model/provider version when available.
- Do not expose fal-specific fields in public API contracts.

### R4: Cost and abuse

Bots may upload large files or generate repeatedly.

Mitigation:

- Direct R2 uploads with strict limits.
- Turnstile.
- Daily quotas.
- One or two concurrent jobs per owner.
- Budget cap.
- Real provider disabled by default in staging.
- Expiry cleanup.

### R5: Long-running workflow correctness

Requests can be retried, webhooks duplicated, or outputs returned late.

Mitigation:

- Idempotent job creation.
- Durable Workflow steps.
- State machine.
- Provider request IDs.
- Duplicate-safe output ingestion.
- Polling fallback.

## 3. Validation sequence

### Stage 0 — Provider experiment

Before implementing the product, manually test the provider playground or a tiny script with a lawful evaluation set.

Dataset:

- 10–20 authorized clips.
- 30–60 seconds each.
- Different genres, tempos, vocals, and instrumentation.
- No copyrighted assets committed to Git.

Test:

- Three presets.
- Two candidates per preset.
- Record output seed and parameters.
- Score manually.

Scorecard, 1–5:

- Melody recognizability.
- Style consistency.
- Instrumental/no-vocal quality.
- Audio naturalness.
- Structural coherence.
- Suitability for study.
- Would keep/download.

Gate:

- Continue only if at least 70% of clips produce one acceptable candidate.
- Investigate another provider or narrower product scope if results fail.

### Stage 1 — Mock vertical slice

Build the complete UX without paid inference:

```text
upload -> confirm -> select preset -> create job
-> Workflow -> mock candidates -> playback -> download -> cleanup
```

The mock provider may copy a fixture or return two known test outputs after simulated delays.

Gate:

- All state transitions tested.
- Duplicate requests safe.
- Private storage and signed downloads working.
- End-to-end test passes.

### Stage 2 — Real-provider spike

Enable fal for one internal tester only.

Gate:

- One real request succeeds end to end.
- Provider key remains secret.
- Output is ingested into private R2.
- Duplicate callback is harmless.
- Cost is recorded.
- Failure path works.

### Stage 3 — Closed technical beta

Invite a small number of users who can provide authorized audio.

Limits:

- Three jobs per day.
- One active job at a time.
- Two candidates.
- No payments.
- Seven-day output retention.

Collect:

- Input category, not song identity.
- Chosen preset.
- Candidate selected.
- Quality rating.
- Failure reason.
- Generation cost and latency.

### Stage 4 — Monetization decision

Only add payment when:

- Quality gate is reached.
- Provider failure rate is acceptable.
- Average direct cost is known.
- Copyright and terms have been reviewed.
- Users demonstrate repeat usage.

## 4. Business model hypothesis

Recommended later model:

- Credit-based rather than unlimited subscription.
- Preview generation priced lower than full-track generation.
- Clear output retention.
- Creator plan for authorized own music.
- No claim of exclusive rights or copyright clearance.

Do not promise “professional arrangement.” Use wording such as:

- AI audio restyling
- instrumental reinterpretation
- study-friendly version
- generated candidate

## 5. Product metrics

### North-star validation metric

`successful preferred outputs per completed generation job`

A successful preferred output means the user:

1. Listens to a meaningful portion.
2. Selects one candidate.
3. Rates it acceptable or downloads it.

### Quality metrics

- Completion rate.
- Jobs with at least one accepted candidate.
- Candidate selection rate.
- Average melody-recognition rating.
- No-vocal rating.
- Output failure rate by preset.
- Regeneration request rate.

### Cost metrics

- Provider cost per completed job.
- Provider cost per accepted output.
- Storage duration and bytes per job.
- Failed-generation cost.
- Retry cost.

### Retention metrics

- Users returning within 7 days.
- Number of distinct tracks processed per returning user.
- Preset reuse.

Do not optimize signups before validating output quality.

## 6. MVP feature prioritization

### Must

- Private upload.
- Rights declaration.
- Three presets.
- Async job.
- Two candidates.
- Playback and download.
- Expiry.
- Mock and fal providers.
- State-machine tests.
- Quota and kill switch.

### Should

- Traditional Chinese UI.
- User deletion action.
- Simple feedback.
- Provider cost estimate.
- Admin job inspection without audio access.

### Could

- Email completion notification.
- Waveform.
- 60-second source clipping.
- Basic CPU media validation service.

### Won't for MVP

- Payments.
- Playlists.
- Arbitrary prompts.
- Social pages.
- Public catalogue.
- Artist imitation.
- Self-hosted GPU.
- Demucs/MIDI pipeline.

## 7. Engineering principles

- Vertical slices before broad scaffolding.
- Mock external services.
- Contracts before implementation.
- Tests for states and side effects.
- One source of truth for job status.
- Private-by-default storage.
- No paid call from tests.
- No secret in client code.
- No hidden fallback from mock to real provider.
- Every irreversible or paid action requires an explicit feature flag.
