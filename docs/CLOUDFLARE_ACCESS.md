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

## 2. Protect the private paths with Access

In Cloudflare Zero Trust:

1. Go to **Access controls → Applications** and add a **Self-hosted** application.
2. Add the production custom hostname destinations for `/app*` and `/api/*` to the same application.
   Do not add the bare hostname or `/`, because the product overview and legal notices are intentionally
   public. The checked-in deployment setting disables the default `workers.dev` hostname.
3. Add an **Allow** policy for the exact beta-tester email addresses or approved identity-provider
   group. Do not use an `Everyone` or permanent `Bypass` rule.
4. Do not add a Service Auth rule to the interactive web application. The application rejects
   service-token JWTs because they are not user identities.
5. Choose an appropriately short application and policy session duration for the private beta.

Cloudflare supports path destinations and evaluates more-specific application paths first:
<https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/>

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
2. In a private browser window, confirm that `/`, `/legal/privacy`, `/health`, and
   `/legal/documents.json` load without login and create no owner row.
3. Confirm `/app` and `/api/auth/me` show Access login or denial before the Worker is reached.
4. Confirm an approved identity can load `/api/auth/me` and receives a valid owner ID response. Do not
   copy the value into screenshots, issues, commits, or public documentation.
5. Confirm an unapproved email is denied by Access.
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

There must be no Bypass policy, broader conflicting application, preview hostname, or default Worker
hostname that exposes `/app*` or `/api/*` outside the authentication boundary.

## 6. Connect GitHub automatic deployment

Use Cloudflare Workers Builds for deployment and GitHub Actions for validation. This avoids storing a
Cloudflare deployment token in the repository or GitHub Actions secrets.

1. In the Worker's **Settings → Builds**, connect the GitHub repository through the Cloudflare Workers
   Builds GitHub App. This is a one-time account-authorized action.
2. Set the production branch to `main` and keep automatic production deployments enabled.
3. Use repository root `/`, build command `pnpm build:web`, deploy command
   `pnpm --filter @studymix/api deploy:cloudflare`, and preview command
   `pnpm --filter @studymix/api preview:cloudflare`.
4. Add `DEPLOY_WORKER_NAME`, `DEPLOY_D1_NAME`, and `DEPLOY_D1_ID` as protected build settings in
   Cloudflare. Their values must never be committed or printed in public build documentation.
5. Keep `APP_ENV`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `LEGAL_CONTACT_EMAIL`,
   `GENERATION_PROVIDER=mock`, and `REAL_GENERATION_ENABLED=false` as Worker runtime variables. The
   generated deployment config uses `keep_vars` and does not redefine them.
6. Require the GitHub `CI` check before merging to `main`. A merged production commit is then deployed
   by Workers Builds; non-production branch uploads do not receive production traffic.

Cloudflare Workers Builds configuration reference:
<https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>
