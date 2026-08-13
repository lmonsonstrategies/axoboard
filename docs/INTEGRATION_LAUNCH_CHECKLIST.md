# AxoBoard direct integration launch checklist

This is the repeatable contract for every provider. Google Sheets is the first implementation; every later connector must conform to the same tenant, token, health, and KPI-mapping boundaries.

Visual wireframe: docs/INTEGRATION_SETUP_WIREFRAME.html.

## One-time AxoBoard owner setup

1. Register separate development and production applications with the provider.
2. Use an AxoBoard-owned developer account and business identity. Never reuse Murphy Door applications, service accounts, credentials, browser sessions, or data.
3. Set the exact production callback:

       https://axoboard.io/api/integrations/oauth/{provider}/callback

4. Request the minimum scopes needed for the first customer outcome.
5. Store the provider client ID, client secret, and AxoBoard token-encryption key only as Railway service variables.
6. Record provider terms, trademark status, scope justification, callback, revocation endpoint, token lifetime, rate limits, and approval owner.
7. Build a provider adapter behind one AxoBoard connection contract:

       authorize → callback → discover → test → sync → refresh → disconnect

## Customer connection flow

    Integrations
      → Add integration
      → Review requested access
      → Provider consent
      → Verify callback and tenant ownership
      → Choose file/object
      → Choose sheet/table/field/range
      → Filter and aggregate
      → Preview value, definition, and freshness
      → Save KPI draft
      → Publish a version with rollback

The browser receives connection status and safe metadata only. OAuth access tokens and refresh tokens never enter browser storage, URLs, analytics, customer-facing errors, or logs.

## Google Sheets first slice

- AxoBoard Google Cloud project and production web OAuth client
- Google Sheets API and Google Drive API enabled
- Exact callback registered
- Narrow per-user consent
- Server-side state + PKCE verification
- AES-256-GCM token encryption with key rotation plan
- File discovery, worksheet discovery, and A1-range selection
- One KPI calculation with visible source lineage
- Scheduled refresh with retries/backoff capped at three
- Stale threshold and last-known-good value
- Disconnect/revoke flow
- Two-tenant swapped-connection test returns 403 with zero Google calls

## Connector release gate

A provider is not labeled **Live** until all of these pass:

- Fresh OAuth consent and reconnect
- Tenant isolation and authorization tests
- Provider token refresh and revocation
- Rate-limit, timeout, partial-data, and provider-outage handling
- Mapping drift and missing-field/range detection
- Visible freshness, last sync, last error, and retry count
- No secrets in Git, Railway build logs, browser payloads, analytics, or support bundles
- Mobile setup flow at 320px and physical iOS/Android checks
- Provider trademark/partner requirements approved for public marketing
- Backup, rollback, and customer disconnect runbook tested

## Recommended implementation order

1. Google Sheets: one cell/range KPI end to end.
2. Dashboard draft, layout, publish, version, and rollback persistence.
3. Stripe subscription entitlement and customer portal.
4. HubSpot: objects, properties, filters, and aggregation.
5. Shopify: orders, refunds, products, and revenue.
6. Microsoft Graph for Excel/OneDrive.
7. Wix and Salesforce only after customer demand and API/partner review justify the maintenance cost.
