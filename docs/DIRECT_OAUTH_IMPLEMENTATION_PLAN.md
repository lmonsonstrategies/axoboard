# Direct OAuth implementation plan

Updated: 2026-08-12
Decision: AxoBoard owns provider OAuth directly; Nango is removed from the runtime path.

## Architecture

```text
Customer browser
  -> POST /api/axoboard/integrations/oauth/start
  -> provider consent (Google first)
  -> GET /api/axoboard/integrations/oauth/{provider}/callback
  -> validate one-time state + PKCE verifier
  -> exchange authorization code server-side
  -> encrypt tokens with AES-256-GCM
  -> store tenant-owned connection
```

Provider client secrets, access tokens, and refresh tokens remain server-side. Public connection responses contain only AxoBoard connection IDs, provider, account label, scopes, status, and timestamps.

## Piece 1 — Google Sheets

- Fresh AxoBoard Google Cloud OAuth application.
- Exact callback: `https://axoboard.io/api/integrations/oauth/google/callback`.
- Initial scopes: OpenID, email, and Sheets read-only. The MVP accepts a spreadsheet URL/ID instead of requesting restricted Drive-wide discovery.
- Ten-minute one-time state and PKCE S256 challenge.
- Offline access with explicit consent for a refresh token.
- AES-256-GCM encrypted PostgreSQL token envelopes with tenant/connection-bound authenticated data.
- Account identity fetched from Google's OpenID userinfo endpoint after token exchange.

## Piece 2 — Google resource discovery

- Refresh access token server-side when needed.
- Accept an exact spreadsheet URL/ID; Google Picker plus `drive.file` remains the later per-file discovery upgrade.
- Select a sheet and exact A1 range.
- Preview one numeric KPI with source lineage and freshness.

## Piece 3 — HubSpot

- Add a fresh AxoBoard HubSpot public app.
- Reuse the direct OAuth connection contract and encrypted store.
- Add deals/schema read scopes only.
- Discover object, standard/custom property, filters, and aggregation.

## Release gates

- Swapped tenant/connection IDs return `403` with zero provider calls.
- OAuth state is one-time, expires, and fails closed after restart.
- Tokens never appear in responses, logs, browser storage, or Git.
- Reconnect, revoke, and disconnect behavior is tested.
- Separate Google OAuth clients and encryption keys are required for development and production.
