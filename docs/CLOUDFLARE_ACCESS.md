# Cloudflare Access deployment gate

Production and staging must remain unavailable until every item in this document is complete. The
Worker deliberately fails closed when the Access configuration is absent or still contains repository
placeholders. This public document never records actual Cloudflare account, D1, Access, Worker, route,
or other resource identifiers.

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

## 2. Put Access in front of the entire Worker

In Cloudflare Zero Trust:

1. Go to **Access controls → Applications** and add a **Self-hosted** application.
2. Select the intended Worker as the destination, including production deployments. Protecting
   the Worker by name prevents an alternate `workers.dev` hostname from bypassing the policy.
3. Add an **Allow** policy for the exact beta-tester email addresses or approved identity-provider
   group. Do not use an `Everyone` or permanent `Bypass` rule.
4. Do not add a Service Auth rule to the interactive web application. The application rejects
   service-token JWTs because they are not user identities.
5. Choose an appropriately short application and policy session duration for the private beta.

Cloudflare's current guidance calls protecting the Worker by name the safest and most direct option:
<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/#protecting-workers>

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
2. In a private browser window, confirm that `/`, hashed assets, `/legal/privacy`, `/api/health`, and
   `/api/legal/documents` all show the Access login or denial page before the Worker is reached.
3. Confirm an approved identity can load `/api/auth/me` and receives an `own_…` owner ID.
4. Confirm an unapproved email is denied by Access.
5. Send a request without `Cf-Access-Jwt-Assertion` directly to the Worker and confirm a `401`
   response with no owner row created.
6. Send a malformed or expired JWT and confirm it is rejected without token details in the response
   or logs.
7. Confirm `/cdn-cgi/access/logout` clears the application session.
8. Confirm every authenticated application response uses `Cache-Control: private, no-store`, including
   SPA fallbacks and legal pages.
9. Confirm the legal manifest exposes the real monitored contact and current document versions, then
   submit, repeat, and query acceptance for an approved test owner.
10. Confirm a denied identity and a second approved identity cannot read or satisfy the first owner's
    legal or metadata state.

There must be no path-specific Access application or Bypass policy that leaves static assets, API
routes, preview deployments, or the default Worker hostname outside the authentication boundary.
