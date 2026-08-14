# Retired Nango Implementation Plan

Updated: 2026-08-12
Decision status: Retired on 2026-08-12. AxoBoard now owns direct provider OAuth to avoid connector-platform fees. See `DIRECT_OAUTH_IMPLEMENTATION_PLAN.md`.

## Operating rule

Each customer authorizes each provider account once through OAuth. Nango maintains that connection with refresh tokens. A new tenant, a deliberately reset test tenant, or a revoked connection must start a new consent flow. AxoBoard never borrows a connection or credential from another tenant.

## Phase 0 — Owner setup

These steps require Leroy because they create external accounts/apps and expose secrets. Do not paste secrets into chat or commit them.

1. Create an AxoBoard Nango account at [app.nango.dev/signup](https://app.nango.dev/signup).
2. In the Nango `dev` environment, create a scoped backend API key with the permissions needed to create Connect sessions, read/manage connections, proxy provider calls, and run enabled actions/syncs.
3. Copy the separate webhook signing key from **Environment Settings → Webhooks**.
4. Store both locally in `/home/ops/.openclaw/workspace-murphy/.credentials/axoboard-nango-dev.env` with mode `600`; never reuse an existing Murphy credential.
5. Create fresh AxoBoard-owned developer apps in Google Cloud and HubSpot. Use Nango's callback shown by each integration—Nango Cloud currently documents `https://api.nango.dev/oauth/callback`—and verify the exact callback in the Nango integration screen before saving.

Suggested secret file:

```dotenv
NANGO_API_KEY=replace_in_local_file
NANGO_WEBHOOK_SIGNING_KEY=replace_in_local_file
```

## Phase 1 — Provider configuration

### Google Sheets

- Create a new Google Cloud project named `AxoBoard Integrations Dev`.
- Enable Google Sheets API and the Google Drive API needed for file selection.
- Configure an external OAuth consent screen with AxoBoard identity, support contact, privacy policy, and test users.
- Create a Web application OAuth client using the callback displayed by Nango.
- Start read-only: spreadsheet content plus the narrowest file-selection scope that supports the picker. Confirm final scopes in a real picker spike before requesting Google verification.
- Configure Nango integration ID `google-sheet` with the new client ID/secret.
- Do not activate Nango shared credentials for this test.

### HubSpot

- Create a fresh AxoBoard developer app, separate from Murphy production integrations.
- Set the Nango callback displayed by the integration.
- Start with `oauth` plus read scopes for deals and CRM schema/property discovery. Add contacts/companies only when a KPI requires them.
- Configure Nango integration ID `hubspot` with the new client ID/secret.
- Install only through the AxoBoard/Nango Connect flow; do not import a private-app token.

## Phase 2 — AxoBoard backend slice

Implement these endpoints behind the existing authenticated AxoBoard route:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/axoboard/integrations/connect-session` | Validate user/workspace, then issue a short-lived Nango Connect session restricted to one integration |
| `POST /api/axoboard/integrations/nango/webhook` | Verify raw-body `X-Nango-Hmac-Sha256`, reconcile tags, and save the connection |
| `GET /api/integrations` | List tenant-owned connection status without exposing credentials |
| `POST /api/integrations/:id/reconnect` | Issue a Nango reconnect session for the same tenant-owned connection |
| `DELETE /api/integrations/:id` | Revoke/delete connection and stop dependent mappings after confirmation |
| `GET /api/integrations/:id/resources` | List Google spreadsheets/sheets or HubSpot objects |
| `GET /api/integrations/:id/fields` | List ranges/columns or HubSpot standard/custom properties |
| `POST /api/kpi-mappings/preview` | Fetch, normalize, aggregate, and return a non-published KPI preview |

Connect sessions must include opaque tags:

```json
{
  "end_user_id": "user_opaque",
  "organization_id": "tenant_opaque",
  "workspace_id": "workspace_opaque",
  "end_user_display_name": "Leroy",
  "end_user_email": "authorized-user@example.com"
}
```

Never trust those returned tags by themselves. Match the webhook to an unexpired server-side connection intent and verify that the authenticated tenant owns the resulting connection before saving it.

## Phase 3 — First KPI tests

### Google acceptance test

1. Reset Murphy Door to blank.
2. Start Google OAuth from AxoBoard and complete fresh provider consent.
3. Select one spreadsheet, sheet, and A1 range.
4. Preview a numeric aggregation and publish one KPI.
5. Confirm source, selector, fetched time, source time, freshness, and synthetic/live status.

### HubSpot acceptance test

1. Start HubSpot OAuth from the same blank workspace.
2. Select the test portal, deals object, `amount` property, filters, and sum aggregation.
3. Preview and publish one KPI.
4. Confirm property type, portal/account identity, record count, scopes, timestamps, and lineage.

Repeat both tests with a second AxoBoard tenant and deliberately swap connection IDs. Every swapped request must return `403` and make zero provider calls.

## Definition of done

- No existing Murphy credential, service account, private-app token, provider ID, or Nango connection is reused.
- Nango secrets exist only server-side and are separately rotatable by environment.
- Webhooks use the current HMAC-SHA256 header and the dedicated signing key—not the API key.
- One live Google KPI and one live HubSpot KPI render from fresh connections.
- Reconnect preserves mapping configuration; reset/disconnect removes access and stops jobs.
- Two-tenant negative tests prove connection IDs cannot cross boundaries.
- Mobile connection, consent return, picker, preview, error, and reconnect flows pass at 320–430px.

## Current readiness

- Nango `dev` API and webhook signing credentials are stored in the dedicated gitignored server-side credential file with mode `600`.
- The Nango dev webhook is configured to the temporary public bridge at `https://murphydashboards.ngrok.io/api/axoboard/integrations/nango/webhook`.
- The AxoBoard bridge now creates tenant-scoped Connect sessions, launches Nango's hosted `connect_link`, validates raw-body HMAC signatures, rejects unmatched auth intents, and stores only sanitized connection metadata.
- Nango dev currently has zero provider integrations. Google Sheets and HubSpot OAuth remain blocked until fresh AxoBoard-owned client IDs/secrets are configured as integration IDs `google-sheet` and `hubspot`.
- `axoboard.io` is owned but is not yet routed to an AxoBoard production application.
- No existing Murphy credential is part of this setup.

The temporary ngrok bridge unblocks development webhooks. End-to-end provider consent is now blocked only on configuring the two fresh provider OAuth applications in Nango; external-customer testing still requires a dedicated AxoBoard API origin.

## Production origin gate

Provision a dedicated AxoBoard production environment before registering final callbacks:

1. Create a separate VPS or managed container service for AxoBoard; do not share the Murphy Dashboards process or credential store.
2. Point `app.axoboard.io` to the web application and `api.axoboard.io` to the authenticated API/webhook service.
3. Terminate TLS with automatic renewal and redirect HTTP to HTTPS.
4. Expose `POST https://api.axoboard.io/api/integrations/nango/webhook` as the Nango webhook target. Verify the raw request body before JSON parsing and reject invalid signatures.
5. Keep Nango and provider secrets in the production platform's secret manager, separately from development values.
6. Add health checks, structured redacted logs, backups, deploy rollback, and alerts before inviting any external customer.
7. Register the exact production callback/origin values in Nango, Google Cloud, and HubSpot only after DNS and TLS are stable.

Infrastructure provisioning, DNS mutation, firewall rules, and production secret creation require an explicit deployment approval because they change security and external state.

## Current references

- [Nango Auth guide](https://nango.dev/docs/guides/auth/auth-guide)
- [Nango connection tags/configuration/metadata](https://nango.dev/docs/guides/auth/connection-tags-configuration-metadata)
- [Nango webhook verification](https://nango.dev/docs/guides/platform/webhooks-from-nango)
- [Nango Google Sheets setup](https://nango.dev/docs/api-integrations/google-sheet/how-to-register-your-own-google-sheet-api-oauth-app)
- [Nango HubSpot setup](https://nango.dev/docs/api-integrations/hubspot/how-to-register-your-own-hubspot-api-oauth-app)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [HubSpot OAuth quickstart](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide)
