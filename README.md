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
- The dashboard and integration flows remain prototype workflows until their server-backed milestones are complete.
- Google Sheets is the first direct connector in development. Other named providers are roadmap items, not live-integration claims.

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
