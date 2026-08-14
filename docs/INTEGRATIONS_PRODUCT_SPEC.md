# AxoBoard integrations and KPI builder specification

Version 0.1 · August 2026

## Goal

Let a nontechnical workspace editor connect an account, select exact source data, turn it into a trustworthy KPI, preview it, and publish it without exposing credentials or requiring engineering work.

## Shared connection flow

1. Admin chooses a provider.
2. API creates an OAuth transaction with tenant, user, return path, nonce/state, PKCE material where supported, requested scopes, and a ten-minute expiry.
3. Browser is redirected to the provider's authorization page.
4. Callback validates state before exchanging the authorization code server-side.
5. Refresh token is encrypted through managed KMS; ordinary application rows store only a credential reference.
6. Worker tests the connection, discovers accessible schema, and records health.
7. Editor selects source data and creates a versioned KPI mapping.
8. Worker refreshes the mapping with rate-limit-aware retries and exposes freshness/lineage.
9. Disconnect revokes credentials where supported, stops workers, and executes the tenant retention/deletion policy.

Never put provider access tokens in browser storage, query strings, application logs, or card configuration.

## Google Sheets

### Authorization

Use Google's web-server OAuth 2.0 flow. Prefer Google Picker with the per-file `drive.file` scope rather than broad Drive access. Request the narrowest Sheets read scope needed for KPI reporting. Store refresh tokens server-side and support incremental authorization if writeback is added later.

Google recommends OAuth client libraries for secure implementation and identifies `drive.file` plus Picker as the safer per-file pattern. See [Google OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server) and [Drive API scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

### Builder flow

1. Pick a Google spreadsheet using Picker.
2. Fetch spreadsheet metadata and list `sheets[].properties`.
3. Pick a sheet.
4. Select or type an A1 range, named range, row, column, or single cell.
5. Fetch a small preview through `spreadsheets.values.get` or `batchGet`.
6. Choose interpretation: single value, sum, average, count, min/max, or latest non-empty value.
7. Choose display format, comparison, goal/status rule, refresh, and stale threshold.
8. Save a mapping and preview the resulting KPI.

The Sheets API represents value ranges in A1 notation and supports retrieving multiple ranges through `batchGet`. See [spreadsheets.values](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values) and [spreadsheet metadata](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets).

### Mapping example

```json
{
  "provider": "google_sheets",
  "spreadsheetId": "encrypted-or-provider-reference",
  "sheetId": 1935852317,
  "sheetTitle": "Summary",
  "range": "D8",
  "readMode": "single_value",
  "valueRenderOption": "UNFORMATTED_VALUE",
  "refreshSeconds": 300,
  "staleAfterSeconds": 900
}
```

Persist both immutable `sheetId` and display `sheetTitle`. Detect renamed/deleted sheets, range shrinkage, formula errors, empty results, permission loss, and locale/number-format changes.

## HubSpot

### Authorization

Create a public HubSpot app and use its OAuth installation flow with exact required/optional scopes and a cryptographically random `state`. Use the current date-versioned token API rather than starting new work on legacy OAuth v1. HubSpot access tokens expire quickly; refresh and cache them server-side.

See [HubSpot OAuth quickstart](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide) and [2026-03 token management](https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens).

### Builder flow

1. Pick an accessible CRM object: deals, contacts, companies, tickets, or an approved custom object.
2. Discover standard and custom properties through the Properties API.
3. Pick a property and inspect its type, options, archive state, and modification timestamp.
4. Choose aggregation: sum, count, average, min/max, conversion rate, stage duration, or latest value where meaningful.
5. Add typed filters, date property/window, pipeline/team/owner dimensions, and comparison.
6. Preview record count, sample values, calculated result, and estimated refresh cost.
7. Save the mapping and start incremental refresh or webhook-supported updates.

HubSpot stores CRM fields as properties and supports both default and custom properties. The current documentation exposes date-versioned Properties API routes by object type. See [HubSpot CRM and Properties API overview](https://developers.hubspot.com/docs/api-reference/latest/crm/understanding-the-crm).

### Mapping example

```json
{
  "provider": "hubspot",
  "portalId": "provider-reference",
  "objectType": "deals",
  "property": "amount",
  "aggregation": "sum",
  "filters": [
    { "property": "dealstage", "operator": "IN", "values": ["closedwon"] },
    { "property": "closedate", "operator": "BETWEEN", "window": "this_month" }
  ],
  "refreshSeconds": 300,
  "staleAfterSeconds": 900
}
```

### HubSpot edge cases

- Property deleted, archived, renamed, or type changed.
- Enumeration internal value differs from its user-facing label.
- Portal does not own a product required by an optional scope.
- Record search/association limits require pagination or batch endpoints.
- Access token expires mid-sync or app is uninstalled.
- Custom currency/date semantics differ by portal timezone.
- Large portals require incremental cursors, webhooks, or materialized serving data rather than live dashboard queries.

## Core entities

| Entity | Required fields |
| --- | --- |
| `IntegrationConnection` | `tenant_id`, provider, credential reference, scopes, external account, health, last sync |
| `SourceObject` | connection, external object/sheet ID, display label, schema version |
| `KpiMapping` | source, selector/property, aggregation, filters, format, refresh, stale policy |
| `MetricSnapshot` | mapping, value, dimensions, source timestamp, fetched timestamp, lineage hash |
| `SyncRun` | event ID, cursor, status, counts, retry count, provider request IDs, diagnostics |

Every entity and cache key carries `tenant_id`. OAuth callbacks resolve the tenant exclusively from validated server-side state, never from an untrusted callback query parameter.

## Blank-customer and credential-isolation test

The `Murphy Door` example workspace is intentionally disconnected and empty. It must never inherit existing Murphy Door service accounts, OAuth grants, HubSpot tokens, portal references, sheet IDs, browser sessions, or fixtures. Each connection test begins with a new authorization session and a fresh provider consent handoff.

The beta may display synthetic KPI fixtures only when they are continuously labeled as synthetic. A reset removes those fixtures and all ephemeral authorization attempts without affecting another tenant. See [Blank Customer OAuth Test Plan](BLANK_CUSTOMER_OAUTH_TEST_PLAN.md).

Nango is the selected connector broker behind an AxoBoard-owned adapter contract. Initial implementation remains bounded by licensing, data-processing terms, cost, exportability, isolation tests, and a direct-provider escape hatch before production release. See [Connector Platform Evaluation](CONNECTOR_PLATFORM_EVALUATION.md) and [Nango Implementation Plan](NANGO_IMPLEMENTATION_PLAN.md).

## Observability and failure handling

- Exponential backoff with jitter; cap routine retries at three before surfacing a degraded state.
- Honor provider rate-limit headers and retry-after values.
- Make syncs idempotent and cursor-based.
- Log input summary, source selector, decision, external status, provider request ID, row/record count, retry count, and duration—never token values or unrestricted source payloads.
- Preserve last known good values with a visible stale timestamp when refresh fails.
- Alert administrators before refresh-token or consent problems make dashboards misleading.

## MVP definition of done

- Google and HubSpot OAuth complete end to end in isolated test tenants.
- Editor can build, preview, save, publish, and delete one KPI from each provider.
- Google selection supports spreadsheet, sheet, and A1 range.
- HubSpot selection supports object, standard/custom property, filters, and aggregation.
- Each KPI displays source lineage, last refresh, and stale status.
- Disconnect and tenant deletion paths are tested.
- Rate-limit, expired-token, deleted-property, deleted-sheet, empty-range, and provider-outage tests pass.
