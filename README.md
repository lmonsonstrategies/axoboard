# AxoBoard

A standalone product-discovery repository for turning the proven Murphy Dashboards workflows into a configurable, multi-tenant operations dashboard SaaS.

## Separation rule

- Murphy Dashboards remains the production customer implementation and validation environment.
- AxoBoard gets its own repository, tenant model, branding, authentication, billing, data contracts, and deployment pipeline.
- Proven Murphy cards and connector logic may be extracted only after tenant boundaries and generic interfaces exist.
- Murphy credentials, data, names, sheet IDs, routes, artwork, and business rules must never be copied into AxoBoard defaults or fixtures.

## Current artifacts

- [Market analysis](docs/MARKET_ANALYSIS.md)
- [Product and technical blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Interactive wireframe](wireframes/index.html)

## Prototype

Open `wireframes/index.html` directly, or serve the repository locally:

```bash
python3 -m http.server 4173 --directory wireframes
```

Then visit `http://127.0.0.1:4173`.

## Status

Discovery and wireframing only. This repository intentionally does not contain Murphy Dashboards application code.
