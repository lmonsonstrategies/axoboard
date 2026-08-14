# Blank Customer OAuth Test Plan

Updated: 2026-08-12

## Purpose

`Murphy Door` is AxoBoard's blank example customer. It validates signup, integration authorization, KPI visibility, and reset behavior without importing Murphy Door production data or credentials.

## Hard isolation rules

- Start with zero members, connections, dashboards, KPI mappings, displays, rules, sounds, wins, and published brand/game assets.
- Never read or copy the existing Murphy Google service account, HubSpot credentials, browser sessions, access tokens, refresh tokens, portal IDs, sheet IDs, or source records.
- Every Google Sheets or HubSpot connection begins at a fresh provider authorization request.
- Resolve `tenant_id`, connection intent, return location, and PKCE/state material from a short-lived server-side authorization session.
- Store production credentials encrypted server-side and reference them by tenant-scoped opaque IDs. Never expose provider tokens to the browser or logs.
- Disconnect must revoke where supported, delete the credential reference, stop sync jobs, and visibly stale or remove dependent KPIs.

## Beta behavior

The current static beta is an honest OAuth handoff wireframe. It creates a new ephemeral test attempt every time, shows the required controls, and never redirects to a provider or stores a token. Live OAuth remains blocked until AxoBoard-owned provider apps, approved scopes, callback routes, encrypted storage, and a backend exchange are configured.

Synthetic KPI fixtures may be loaded to test card visibility and responsive behavior. They are labeled `SYNTHETIC TEST DATA` and must never be presented as connected Murphy, Google, or HubSpot data.

## Repeatable test

1. Open the Murphy Door workspace and confirm the dashboard reports `No KPIs yet`.
2. Open Integrations and confirm both sources are disconnected.
3. Start Google OAuth; confirm attempt number, Murphy tenant scope, credential-reuse block, state validation, and prototype boundary.
4. Cancel and start HubSpot OAuth; confirm the workflow starts at preflight with a new attempt.
5. Load synthetic KPIs and confirm the banner remains visible above every fixture card.
6. Refresh and confirm the workspace remains Murphy Door and test fixtures retain their label.
7. Reset the workspace and confirm zero KPIs/connections and no stored OAuth test session.
8. Switch to Acme Sales and confirm its populated fixtures remain isolated; switch back and confirm Murphy Door remains blank.

## Production acceptance

- Google and HubSpot authorization-code flows complete with AxoBoard-owned OAuth apps and exact registered callbacks.
- Unique, expiring state is validated once; PKCE is used where supported/required; callback replay fails closed.
- Minimal scopes are requested incrementally.
- Connection records and tokens cannot be accessed across tenants, including through job queues, caches, logs, exports, or support tooling.
- Token rotation, expiry, revocation, user denial, callback mismatch, rate limits, and provider outage are observable and recoverable.
- Google spreadsheet/sheet/range selection and HubSpot object/property/filter selection work from the newly authorized account only.
- Reset deletes test tenant data and credential references without affecting another workspace.

## Provider references

- [Google OAuth for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth security best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [HubSpot OAuth guide](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide)
- [HubSpot OAuth token endpoint](https://developers.hubspot.com/docs/api-reference/auth-oauth-v3/public-token/post-oauth-v3-token)
