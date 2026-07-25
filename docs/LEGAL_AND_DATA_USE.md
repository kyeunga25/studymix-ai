# Legal and data-use controls

## Status and scope

This is an engineering and launch-control document, not legal advice. It records the product behavior,
technical enforcement, official-source checks, and unresolved decisions for the authenticated private
beta. The English and Traditional Chinese website documents are pre-release drafts. A Hong Kong
lawyer must confirm the operator identity, service address, consumer terms, liability wording,
copyright position, cross-border disclosures, and complaint process before a public launch.

The current code has authentication, owner-scoped D1 metadata, legal-document APIs, and the web shell.
It also contains default-off private-R2 upload plus mock and fal Workflow modes. The mock Workflow creates
synthetic tones without sending source audio to an external provider. The fal mode is locally wired and
offline-tested but has not made a paid or real-audio request. Production R2 upload, server-side
generation, provider callbacks, and automatic object deletion remain disabled until their release gates
pass. Public copy must not describe a test-only control as already operational.

## Versioned website documents

| Document | Route | Current version | Server acceptance required |
| --- | --- | --- | --- |
| Terms of Use | `/legal/terms` | `2026-07-24` | Yes |
| Privacy Notice / PICS | `/legal/privacy` | `2026-07-24` | No; notice is acknowledged, not converted into optional consent |
| Acceptable Use Policy | `/legal/acceptable-use` | `2026-07-24` | Yes |
| AI and Output Notice | `/legal/ai-output-notice` | `2026-07-24` | Yes |

`GET /legal/documents.json` returns the configured contact and current public manifest without creating
an owner record. The authenticated compatibility route `GET /api/legal/documents` returns the same
manifest inside the private API boundary.
`GET /api/legal/acceptances` returns only the authenticated owner's current status.
`POST /api/legal/acceptances` accepts an exact, complete, non-duplicated set of current required
versions. The Worker derives the owner from the verified Cloudflare Access assertion and supplies the
acceptance time. Browser-supplied owner IDs, acceptance times, unknown fields, stale versions, oversized
bodies, and non-JSON bodies are rejected. Repeating the same versions is idempotent and preserves the
original evidence timestamp.

The job-creation route calls the owner-scoped legal-acceptance repository before inserting a job and
separately persists the job/upload-specific rights declaration with a server timestamp. Exact rights
declaration versions are enforced by the shared Zod contract. A client checkbox alone is not the control.

## Current data map

| Data | Source | Current use | Recipient | Current retention/status |
| --- | --- | --- | --- | --- |
| Access identity/session | Approved user and configured identity provider | Authentication | Cloudflare Access; verified by Worker | Application does not store JWT, password, or email in D1 |
| Hashed Access subject and derived owner ID | Verified Access claims | Owner isolation and account status | Worker and D1 | Stored while the private-beta account and necessary audit records exist |
| Legal document/version/time | User action plus server time | Evidence of governing versions | Worker and D1 | Retention schedule must be finalized; retain only while necessary for evidence/disputes |
| File selected in default public deployment | User device | Local interface preview | Browser only | Not uploaded while private R2 is disabled |
| Feature-gated staging audio upload | Approved tester | Direct private-object upload and metadata confirmation | Cloudflare R2 and owner-scoped D1 metadata only | Default/production off; explicit upload and terminal-job deletion plus scheduled cleanup are implemented and locally tested, but live Cron monitoring is not yet verified |
| Feature-gated synthetic mock outputs | Approved tester action | Verify the private asynchronous job and delivery flow without external AI | Cloudflare Workflow, private R2, and owner-scoped D1 metadata | Default/production off; output expiry and retry-safe scheduled object cleanup are locally tested, but not yet enabled in production |
| Feature-gated real-provider audio | Approved tester using authorized audio | Private audio-to-audio generation and result delivery | Cloudflare, fal.ai, private R2, and owner-scoped D1 metadata | Default/production off; Workflow mapping and bounded private ingestion are offline-tested, but no paid or real-audio staging check has run |
| fal completion callback | fal.ai | Wake the matching Workflow before it rechecks the provider API | Cloudflare Worker and Workflow | Signed raw body is verified within a five-minute window; only known request ID and candidate index are signaled, while the complete body is discarded and not stored |
| Real-generation rate key | Cloudflare request metadata | Coarse abuse protection before job creation | Cloudflare Rate Limiting binding | Short per-location counter window; the application hashes the connecting IP before use and does not store the raw IP or hash in D1 |
| Operational event data | Worker | Security and troubleshooting | Cloudflare observability | Must exclude audio, filename, signed URL, assertion, secrets, and raw provider payloads |

StudyMix AI does not ingest arbitrary remote URLs, scrape tracks or personal data from official sites,
third-party websites, public databases, social platforms, or data-source APIs. Public availability is not
treated as permission. User uploads are not used to train a StudyMix AI model. No equivalent promise
may be made for an external provider until a signed contract or DPA expressly supports it.

## Hong Kong privacy controls

The Office of the Privacy Commissioner for Personal Data describes six Data Protection Principles:
lawful and non-excessive collection with notice; data accuracy and limited retention; purpose-limited
use; security, including processor controls; openness; and access/correction rights. The website notice
therefore identifies the categories and purposes, required nature, recipients, planned retention,
security controls, contact route, and access/correction/deletion process. Processor arrangements need
contractual or other means to enforce retention and security, not just a link to a vendor privacy page.

Official references checked on 2026-07-24:

- [PCPD: The Data Protection Principles](https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html)
- [PCPD: Data Security](https://www.pcpd.org.hk/english/data_security/index.html)
- [PCPD: Privacy Management Programme and PICS/PPS guidance](https://www.pcpd.org.hk/english/news_events/media_statements/press_20130729.html)
- [PCPD: Personal data obtained from the public domain remains protected](https://www.pcpd.org.hk/english/news_events/media_statements/press_20130813a.html)

Public launch is not approved while the checked-in legal contact remains a placeholder or while the
operator and processing disclosures are incomplete.

## Copyright, recordings, and public data

Hong Kong's Intellectual Property Department explains that copyright protection is automatic and can
cover musical works, sound recordings, and sufficiently substantial parts. A source being short,
downloadable, indexed, or publicly accessible does not establish that adaptation or distribution is
permitted. The product therefore limits positioning to recordings the user owns or is authorized to
process, forbids artist-name imitation and remote URL ingestion, requires a job-specific rights
declaration, and does not provide a public result or distribution licence.

- [Hong Kong IPD: What is copyright?](https://www.ipd.gov.hk/tc/copyright/what-is-copyright/index.html)

The operator cannot technically prove the user's chain of title. Engineering must preserve versioned
declarations, prevent cross-owner access, provide a complaint/takedown route, and avoid copy suggesting
that AI generation itself clears input or output rights. Public or commercial output use requires the
user's own review and any necessary licences.

## Cloudflare processor and location checks

Cloudflare's current customer DPA describes Cloudflare as a processor/service provider and includes
security, subprocessor, deletion, and incident terms. Execute or otherwise confirm the applicable DPA
for the operator account and keep a copy of the accepted version and subprocessor review.

R2 and D1 automatically choose locations. Cloudflare's location hints are best-effort, not guarantees.
R2 jurisdiction restrictions can guarantee only supported jurisdictions, and D1's current jurisdiction
options do not provide a Hong Kong residency commitment. The Privacy Notice must therefore not promise
Hong Kong-only storage or processing.

- [Cloudflare Customer DPA](https://www.cloudflare.com/en-gb/cloudflare-customer-dpa/)
- [Cloudflare R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- [Cloudflare D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)

## fal.ai and model-provider release gate

fal.ai's current terms place input-rights and lawful-use duties on the customer and state that outputs
may be non-unique and are not guaranteed original or non-infringing. The API supplemental terms require
protective end-user terms and prohibit exposing direct API access. The key stays only in a Worker secret;
the browser must never call fal directly.

fal's media documentation currently states that API request input/output payloads are stored by default
unless `X-Fal-Store-IO: 0` is used, and that input/generated media may use CDN URLs with separate expiry
and ACL behavior. Deleting a request does not necessarily delete separately uploaded input media. Before
real generation is enabled, the adapter and contract tests must verify for the exact model and current
schema:

1. `X-Fal-Store-IO: 0` is sent and honored.
2. Input and output media use the most restrictive supported ACL and shortest workable expiry.
3. No provider CDN URL becomes the user-facing result; output is streamed into private R2 with byte,
   timeout, redirect, protocol, and destination bounds.
4. Input-media deletion behavior and provider retention are contractually acceptable and reflected in
   the Privacy Notice.
5. Provider model provenance, input use/training, subprocessors, breach notice, deletion, and
   international-transfer terms are reviewed and recorded.
6. End-user Terms and AUP remain at least as protective as the provider agreement.

- [fal Terms of Service](https://fal.ai/legal/terms-of-service)
- [fal API Services Supplemental Terms](https://fal.ai/legal/api-services)
- [fal Privacy Policy](https://fal.ai/legal/privacy-policy)
- [fal media retention and expiration](https://fal.ai/docs/documentation/model-apis/media-expiration)
- [fal Acceptable Use Policy](https://fal.ai/legal/acceptable-use-policy)

Until all six checks pass, `GENERATION_PROVIDER=mock` and `REAL_GENERATION_ENABLED=false` remain hard
release requirements.

## Release boundary

External audio processing remains disabled until the legal documents identify the operator, the contact
route is monitored, processor terms are accepted, and the implemented retention and deletion behavior is
verified. No legal page, checkbox, audit, or disclaimer eliminates all legal or security risk.
