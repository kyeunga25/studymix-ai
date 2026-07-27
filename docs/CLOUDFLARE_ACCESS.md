# Cloudflare private-beta deployment

The product overview and legal notices may be public during the closed beta. The application workspace
and all private APIs must remain unavailable to anyone outside the tester allowlist. The Worker fails
closed on protected paths when the Access configuration is absent or still contains repository
placeholders. This document never records actual Cloudflare account, D1, Access, Worker, or other
resource identifiers.

## 1. Create the D1 database

Create separate staging and production databases. Never point staging at production.

```bash
pnpm --filter @studymix/api exec wrangler d1 create "DATABASE_NAME_PLACEHOLDER"
```

Store the returned database ID and actual database name only in an ignored local deployment config or a
protected CI environment. Do not copy either value into the checked-in Wrangler file. Apply reviewed
migrations using that private deployment config:

```bash
pnpm --filter @studymix/api exec wrangler d1 migrations apply DB --remote --config "PRIVATE_CONFIG_PATH"
```

Do not use ad-hoc schema commands in production. Confirm the migration list before and after the
apply operation.

## 1.1 Prepare private R2 transfer in staging only

Create separate private staging and production buckets. Do not enable an `r2.dev` URL or public custom
domain. Keep `R2_TRANSFER_ENABLED=false` in production while the implemented retention handler and live
expiry monitoring have not passed isolated staging checks.

A staging preview version of the single `studymix-ai` Worker needs:

- an `AUDIO_BUCKET` binding to the staging bucket;
- protected runtime values for `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `MAX_UPLOAD_BYTES`,
  `MAX_ACTIVE_UPLOADS_PER_OWNER`, `UPLOAD_URL_TTL_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS`,
  `ABANDONED_UPLOAD_RETENTION_HOURS`, `SOURCE_RETENTION_HOURS`,
  `FAILED_ARTIFACT_RETENTION_HOURS`, and `RETENTION_CLEANUP_BATCH_SIZE`;
- bucket-scoped Object Read & Write credentials stored only as the Worker secrets
  `R2_S3_ACCESS_KEY_ID` and `R2_S3_SECRET_ACCESS_KEY`.

Generate the ignored exact-origin CORS file from the API directory, apply it to the staging bucket, and
then verify the applied rule. Substitute values locally without placing them in repository files or
public logs:

```bash
DEPLOY_ALLOWED_WEB_ORIGINS=https://staging.example.test pnpm r2:cors:prepare
pnpm exec wrangler r2 bucket cors set BUCKET_NAME_PLACEHOLDER --file wrangler.r2-cors.json
pnpm exec wrangler r2 bucket cors list BUCKET_NAME_PLACEHOLDER
```

The generated rule allows only the exact configured origin, `PUT/GET/HEAD`, `Content-Type`, and
`If-None-Match`. The conditional header is signed as `*`, so a successful upload cannot be overwritten
by reusing its PUT URL. CORS is a browser boundary, not authorization; presigned URLs remain short-lived
bearer credentials and must never be logged. See Cloudflare's current
[presigned URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) and
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) documentation.

Before setting `R2_TRANSFER_ENABLED=true` in staging, verify that a browser uploads directly to the R2
S3 hostname, a second PUT receives `412`, a wrong content type fails, an expired URL fails, another owner
cannot confirm or delete the upload, explicit deletion removes the object, and no audio bytes traverse
the Worker request body. Enable `RETENTION_CLEANUP_ENABLED=true` only in this staging environment, then
verify the hourly Cron removes due objects, updates D1, retries an interrupted deletion, emits counts
without object keys, and does not remove another owner's or a not-yet-due object. Leave production
disabled until those live checks pass.

## 1.2 Prepare the mock Workflow in isolated staging

The server-side mock generation path requires both the private `AUDIO_BUCKET` binding and a
`GENERATION_WORKFLOW` binding whose class is `GenerationWorkflow`. Keep `JOB_WORKFLOW_ENABLED=false`
unless the same isolated staging environment has passed the private R2 checks above. The mock provider
creates two small synthetic WAV tones, makes no paid request, and does not transmit the uploaded source
to an external service.

For Workers Builds, provide the actual Workflow name only through the protected
`DEPLOY_WORKFLOW_NAME` build setting. Omitting it leaves the binding out of the generated deployment
configuration. Set `MAX_ACTIVE_JOBS_PER_OWNER` and `OUTPUT_RETENTION_HOURS` as private runtime values,
then enable `JOB_WORKFLOW_ENABLED=true` only for the approved staging preview version. Keep
`GENERATION_PROVIDER=mock` and `REAL_GENERATION_ENABLED=false`.

Before any production decision, verify owner isolation, exact current legal acceptance, one persisted
rights declaration per job, duplicate-request idempotency, active-job limits, two private outputs,
short-lived signed playback, create-only R2 writes, terminal-job deletion, and Workflow retry behavior.
The hourly retention handler must demonstrate 24-hour unattached/failed-artifact cleanup, 72-hour source
cleanup, 7-day output expiry, and safe retries before the feature is described as production-ready. Cloudflare's current
[Workflows rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) and
[Workers API](https://developers.cloudflare.com/workflows/build/workers-api/) remain the implementation
reference.

## 1.3 Prepare real-provider generation in isolated staging

The fal Workflow path is default-off and must reuse the approved private R2 and Workflow bindings above.
Set `FAL_KEY` and the expected `FAL_WEBHOOK_USER_ID` only as Worker secrets. Their checked-in values are
intentionally invalid type-generation placeholders; the protected deployment generator does not publish
them and `keep_vars` preserves the runtime secrets.

Configure these non-secret bounds in the staging preview version without printing their protected environment or
resource values:

```text
GENERATION_PROVIDER=fal
FAL_WEBHOOK_URL
FAL_OUTPUT_EXPIRATION_SECONDS
FAL_QUEUE_START_TIMEOUT_SECONDS
FAL_POLL_INTERVAL_SECONDS
FAL_MAX_POLL_ATTEMPTS
MAX_PROVIDER_OUTPUT_BYTES
PROVIDER_OUTPUT_TIMEOUT_SECONDS
MAX_DAILY_JOBS_PER_OWNER
```

Set `FAL_WEBHOOK_URL` to the protected staging hostname plus the exact `/api/webhooks/fal` path, with no
query string. Do not copy the actual hostname into the repository or build logs. The real-generation
capability fails closed when either the URL or expected webhook user is missing or still a placeholder.

Provide a positive account-unique rate-limit namespace only through the protected
`DEPLOY_RATE_LIMIT_NAMESPACE_ID` build setting. Omitting it leaves the binding out of the generated
deployment config and causes real-generation capability detection to fail closed. The binding uses a
short per-location window; D1 remains the authoritative rolling owner quota.

Keep `REAL_GENERATION_ENABLED=false` until Turnstile verification, owner usage limits, authorized test
audio, provider-account terms, retention, and deletion checks are ready. The private source download TTL
must exceed the queue-start timeout by at least 60 seconds. When the staging gate is opened, enable
`R2_TRANSFER_ENABLED`, `JOB_WORKFLOW_ENABLED`, and `REAL_GENERATION_ENABLED` only in that environment and
confirm the API advertises real generation only while every required binding, secret, and bound is valid.

Use a single authorized, non-sensitive audio fixture for the manual provider check. Verify two unique
provider request IDs, verified callback wake-ups, polling fallback, streamed private-R2 outputs, no provider
URL, signed URL, or complete callback body in D1 or logs, owner-only playback/download, terminal deletion,
and expiry cleanup. An ambiguous submission must fail closed rather than send a second request automatically.

## 2. Protect the private paths with Access

In Cloudflare Zero Trust:

1. Go to **Access controls → Applications** and add a **Self-hosted** application.
2. Keep `/login` public, and add the production custom hostname destinations for `/app*` and `/api/*`
   to the same application. The sign-in page links to `/app`, which starts Access authentication when
   no valid application session exists.
3. Before enabling fal callbacks, add a separate, more-specific application for the exact
   `/api/webhooks/fal` path with a narrowly scoped **Bypass / Everyone** policy. Do not add a wildcard or
   change the parent private-path policy. The Worker independently rejects callbacks unless the Ed25519
   signature, configured fal user, fresh timestamp, raw body, origin/path, and known request ID all match.

Cloudflare documents that the more-specific application path takes precedence and that Bypass disables
Access controls for only the matched traffic. Recheck the current
[application-path](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
and [Access policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) guidance
before applying this narrow exception.
   Do not add the bare hostname or `/`, because the product overview and legal notices are intentionally
   public. The checked-in deployment setting disables the default `workers.dev` hostname.
3. Add an **Allow** policy for the exact beta-tester email addresses or approved identity-provider
   group. Do not use an `Everyone` or permanent `Bypass` rule.
4. Select only the login method needed by the approved testers. Cloudflare account members may use
   the Cloudflare identity provider. For an invited tester outside the account, explicitly enable
   One-time PIN and keep the exact-email **Allow** selector. A `Login Methods: One-time PIN` include
   rule by itself is not an email allowlist and must not be used to grant access.
5. Do not add a Service Auth rule to the interactive web application. The application rejects
   service-token JWTs because they are not user identities.
6. Choose an appropriately short application and policy session duration for the private beta.

Cloudflare supports path destinations and evaluates more-specific application paths first:
<https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/>

Cloudflare documents the Cloudflare identity provider and email One-time PIN behavior here:
<https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/>

## 3. Configure Worker JWT verification

From the Access application settings, copy:

- the team domain, formatted as `https://<team>.cloudflareaccess.com`;
- the 64-character Application Audience (AUD) tag.

Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` only in the private deployment environment. Do not commit
their values. The Worker validates the JWT signature against Access's rotating remote JWKS and also checks
the RS256 algorithm, issuer, audience, time claims, application-token type, user ID, and verified
email claim.

Cloudflare requires origins behind Access to validate the `Cf-Access-Jwt-Assertion` header rather
than merely trusting that it exists:
<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>

## 4. Configure the legal contact and release documents

Set `LEGAL_CONTACT_EMAIL` to a real, monitored address for privacy access/correction/deletion requests,
rights complaints, security reports, and legal notices. Do not deploy the checked-in `CHANGE_ME`
placeholder. The legal endpoints deliberately return `503` when the contact is invalid, and real
generation must remain blocked.

Before public launch, also replace the draft operator description in the Terms and Privacy Notice with
the lawyer-approved legal name and service address. Complete every provider, location, retention, and
deletion gate in `docs/LEGAL_AND_DATA_USE.md`.

## 5. Pre-release verification

Before production traffic is enabled:

1. Run `pnpm cf-typegen`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
   After preparing the ignored private deployment config, run the privacy-safe active-deployment check:

   ```bash
   DEPLOY_PUBLIC_URL="https://PRIVATE_HOSTNAME" \
   DEPLOY_EXPECT_ENV=production \
   pnpm deploy:verify
   ```

   Its JSON contains only binding/runtime/secret presence, migration counts, live-route booleans, and
   readiness booleans. It deliberately omits resource names, identifiers, hostnames, contact values,
   deployment timestamps, and secret values. Keep its non-zero result until the public surface is fully
   configured and reachable.
2. In a private browser window, confirm that `/`, `/login`, `/legal/privacy`, `/health`, and
   `/legal/documents.json` load without login and create no owner row. Confirm `/login` has no password
   field or active public-registration control.
3. Follow the `/login` action and confirm `/app` and `/api/auth/me` show Access login or denial before
   the Worker is reached.
4. Confirm an approved identity can load `/api/auth/me` and receives a valid owner ID response. Do not
   copy the value into screenshots, issues, commits, or public documentation.
5. Confirm an unapproved email is denied by Access.
   After Access authentication, confirm a D1 owner whose status is `disabled` receives `403` and no
   workspace interface. Browser session checks must send `X-Requested-With: XMLHttpRequest` so expiry is
   handled as `401` without treating redirected HTML as a valid session. This follows Cloudflare's current
   [Access session-management guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#ajax).
6. Send a request without `Cf-Access-Jwt-Assertion` directly to a protected Worker path and confirm a `401`
   response with no owner row created.
7. Send a malformed or expired JWT and confirm it is rejected without token details in the response
   or logs.
8. Confirm `/cdn-cgi/access/logout` clears the application session.
9. Confirm every authenticated application response uses `Cache-Control: private, no-store`, including
   SPA fallbacks.
10. Confirm the legal manifest exposes the real monitored contact and current document versions, then
   submit, repeat, and query acceptance for an approved test owner.
11. Confirm a denied identity and a second approved identity cannot read or satisfy the first owner's
    legal or metadata state.
12. Confirm unsigned, stale, wrong-user, wrong-origin, query-bearing, and unknown-request fal callbacks are
    rejected without creating an owner or storing the body; confirm a valid duplicate is harmless and queue
    polling still completes when no callback arrives.
13. Confirm an approved owner can delete a completed or failed job, its private R2 objects disappear,
    another owner receives `404`, and the hourly Cron reports only bounded aggregate counts.

There must be no Bypass policy except the exact signed fal callback path, no broader conflicting
application, and no preview or default Worker hostname that exposes `/app*` or user-facing `/api/*`
outside the authentication boundary.

## 6. Connect GitHub automatic deployment

Use Cloudflare Workers Builds for deployment and GitHub Actions for validation. This avoids storing a
Cloudflare deployment token in the repository or GitHub Actions secrets.

The connection procedure and branch behavior below were rechecked against Cloudflare's current Workers
Builds documentation on 2026-07-26. An existing Worker is connected through **Settings → Builds →
Connect**. The Worker selected in the dashboard must be `studymix-ai`, matching the fixed name in both
the checked-in and generated Wrangler configuration.

1. In the Worker's **Settings → Builds**, connect the GitHub repository through the Cloudflare Workers
   Builds GitHub App. This is a one-time account-authorized action.
2. Set the production branch to `main` and keep automatic production deployments enabled.
3. Use repository root `/`, build command `pnpm build:web`, deploy command
   `pnpm --filter @studymix/api deploy:cloudflare`, and preview command
   `pnpm --filter @studymix/api preview:cloudflare`.
4. Add `DEPLOY_D1_NAME` and `DEPLOY_D1_ID` as protected build settings in Cloudflare. The Worker name is
   fixed in code and must not be added as a configurable build setting. Add `DEPLOY_R2_BUCKET`, `DEPLOY_WORKFLOW_NAME`, and
   `DEPLOY_RATE_LIMIT_NAMESPACE_ID` only to an approved private staging build; omitting a setting leaves
   that binding out of the generated deployment config. Their values must never be committed or printed
   in public build documentation.
   For authenticated local staging or production operations, set `DEPLOY_CONFIG_PATH` to a distinct
   ignored filename such as `wrangler.staging.json` or `wrangler.production.json`; config generation,
   preview upload, migration checks, and deployment verification must all use that same file. Every file
   still targets `studymix-ai`; use staging resource files only with `preview:cloudflare`, never with the
   production deploy command.
5. Keep `APP_ENV`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `LEGAL_CONTACT_EMAIL`, `R2_ACCOUNT_ID`,
   `R2_BUCKET_NAME`, the R2 limits/TTLs, `R2_TRANSFER_ENABLED=false`,
   `JOB_WORKFLOW_ENABLED=false`, `RETENTION_CLEANUP_ENABLED=false`,
   `MAX_ACTIVE_JOBS_PER_OWNER`, `MAX_DAILY_JOBS_PER_OWNER`,
   `ABANDONED_UPLOAD_RETENTION_HOURS`,
   `SOURCE_RETENTION_HOURS`, `FAILED_ARTIFACT_RETENTION_HOURS`, `OUTPUT_RETENTION_HOURS`,
   `RETENTION_CLEANUP_BATCH_SIZE`,
   `GENERATION_PROVIDER=mock`, and `REAL_GENERATION_ENABLED=false` as Worker runtime variables. Store
   the two R2 S3 credentials only as Worker secrets. The
   generated deployment config uses `keep_vars` and does not redefine them.
6. Require the GitHub `CI` check before merging to `main`. A merged production commit is then deployed
   by Workers Builds; non-production branch uploads do not receive production traffic.

Cloudflare Workers Builds references:

- <https://developers.cloudflare.com/workers/ci-cd/builds/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/>
