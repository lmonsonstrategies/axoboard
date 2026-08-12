# AxoBoard

AxoBoard is a customizable operational dashboard service with KPI displays, celebrations, sounds, automations, and configurable team competition.

## Standalone preview

```bash
npm start
```

Open `http://localhost:3000`. Service health is available at `GET /healthz`.

## Railway

The repository contains a production Dockerfile and `railway.json`. Railway should deploy from the repository root and use `/healthz` as its health check. The first deployment serves the standalone product prototype; authentication, PostgreSQL persistence, and direct provider OAuth are added in subsequent vertical slices.

A standalone product-discovery repository for turning the proven Murphy Dashboards experience into a configurable, multi-tenant celebration and performance platform.

## Product focus

AxoBoard makes performance visible, personal, and fun. The primary product surfaces are:

- customizable team dashboards and TV displays;
- event-driven win celebrations and hype moments;
- `My Sounds`, where teams upload and assign their own audio;
- `Kombat Studio`, a fully rebrandable competition engine inspired by Murphy Kombat;
- one Brand Studio that themes every surface consistently.

The AxoBoard product brand uses the warm whites and pinks of a leucistic axolotl. Customer workspaces can replace that theme completely without changing product behavior or accessibility.

## Separation rule

- Murphy Dashboards remains the production customer implementation and validation environment.
- AxoBoard gets its own repository, tenant model, branding, authentication, billing, data contracts, and deployment pipeline.
- Proven Murphy cards and connector logic may be extracted only after tenant boundaries and generic interfaces exist.
- Murphy credentials, data, names, sheet IDs, routes, artwork, and business rules must never be copied into AxoBoard defaults or fixtures.

## Current artifacts

- [Market analysis](docs/MARKET_ANALYSIS.md)
- [Product and technical blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Customization product specification](docs/CUSTOMIZATION_PRODUCT_SPEC.md)
- [AxoBoard brand guide](docs/AXOBOARD_BRAND_GUIDE.md)
- [Integrations and KPI builder specification](docs/INTEGRATIONS_PRODUCT_SPEC.md)
- [Geckoboard competitive roadmap](docs/GECKOBOARD_COMPETITOR_ROADMAP.md)
- [Visibility and automation specification](docs/VISIBILITY_AUTOMATION_SPEC.md)
- [Mobile usage worksheet and release gate](docs/MOBILE_USAGE_WORKSHEET.md)
- [Feature interaction audit and wireframe inventory](docs/FEATURE_INTERACTION_AUDIT.md)
- [Commercial SaaS service blueprint](docs/SAAS_SERVICE_BLUEPRINT.md)
- [Blank customer OAuth test plan](docs/BLANK_CUSTOMER_OAUTH_TEST_PLAN.md)
- [Connector platform evaluation](docs/CONNECTOR_PLATFORM_EVALUATION.md)
- [Nango implementation plan](docs/NANGO_IMPLEMENTATION_PLAN.md)
- [Interactive wireframe](wireframes/index.html)
- [Primary low-poly AxoBoard logo](assets/brand/axoboard-logo-low-poly.png)

## Prototype

Internal beta preview:

```text
http://10.1.5.121:4173/
```

Authenticated remote beta preview (Leroy only):

```text
https://murphydashboards.ngrok.io/app/axo-beta
```

The internal preview is served directly from this repository by the user-level `axoboard-beta.service`, so saved frontend changes appear after a browser refresh. The remote preview uses the existing Murphy Dashboards login and an additional Leroy-only authorization layer; direct prototype assets remain inaccessible without its short-lived scoped session.

For an ad-hoc local preview, open `wireframes/index.html` directly or run:

```bash
python3 -m http.server 4173 --directory wireframes
```

Then visit `http://127.0.0.1:4173/`.

## Status

Discovery and wireframing only. This repository intentionally does not contain Murphy Dashboards application code.
