# AxoBoard

AxoBoard is a mobile-ready operational KPI dashboard service for turning trusted business data into clear scores, goals, alerts, celebrations, and Team Competitions.

## Run locally

```bash
npm ci
npm start
```

Open `http://localhost:3000`. Health is available at `GET /healthz`. PostgreSQL is required for account creation and paid-workspace access; without `DATABASE_URL`, the public site runs but auth fails closed.

Database changes live in `migrations/` and run automatically at startup under a PostgreSQL advisory lock. Applied filenames and SHA-256 checksums are recorded in `schema_migrations`; never edit an applied migration—add the next numbered file.

## Release model

The repository deploys to Railway from `main` using the root `Dockerfile` and `railway.json`. The production health check is `/healthz`.

```text
feature branch → verification → main → Railway → production verification
```

Required release gates include syntax checks, dependency audit, PostgreSQL entitlement tests, sensitive-route probes, Gitleaks scans, Docker build, mobile browser QA, and exact-commit production verification.

## Current product boundary

- Public marketing, pricing, FAQ, login, and signup surfaces.
- Dashboard code and assets require an authenticated session bound to a workspace with an explicit `active` subscription.
- New accounts default to `pending_payment`; no redirect or browser state can grant access.
- Starter billing uses Stripe-hosted Checkout and Portal sessions. Only raw-body signature-verified, idempotent Stripe webhooks may change workspace entitlement.
- Google Sheets has a server-backed vertical slice: one-time PKCE OAuth, encrypted refresh tokens, recent-first spreadsheet discovery, spreadsheet/sheet/range selection, persisted KPI snapshots, scheduled refresh, visible lineage, and disconnect/revoke.
- Dashboard layout/publish history and providers other than Google Sheets remain roadmap work, not live-integration claims.

## Google Sheets configuration

Create an AxoBoard-owned Google OAuth web application, enable the Google Sheets API and Google Drive API, and register this exact callback:

```text
https://axoboard.io/api/integrations/oauth/google/callback
```

Set `AXOBOARD_GOOGLE_CLIENT_ID`, `AXOBOARD_GOOGLE_CLIENT_SECRET`, `AXOBOARD_GOOGLE_REDIRECT_URI`, and a new base64-encoded 32-byte `AXOBOARD_OAUTH_ENCRYPTION_KEY` in Railway. The connector requests `openid`, `email`, `drive.metadata.readonly`, and `spreadsheets.readonly`. Drive access is metadata-only and is used to list spreadsheet names and modified dates; selected cell contents are read through the Sheets read-only scope. `AXOBOARD_SYNC_INTERVAL_MS` controls how often the worker claims due mappings, while each mapping defaults to a five-minute refresh.

## Key documents

- [Release runbook](docs/RELEASE_RUNBOOK.md)
- [Stripe billing implementation plan](docs/STRIPE_BILLING_IMPLEMENTATION_PLAN.md)
- [Integration setup wireframe](docs/INTEGRATION_SETUP_WIREFRAME.html)
- [Integration launch checklist](docs/INTEGRATION_LAUNCH_CHECKLIST.md)
- [Product and technical blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Commercial SaaS service blueprint](docs/SAAS_SERVICE_BLUEPRINT.md)
- [Brand guide](docs/AXOBOARD_BRAND_GUIDE.md)
- [Feature interaction audit](docs/FEATURE_INTERACTION_AUDIT.md)

Production: `https://axoboard.io`
