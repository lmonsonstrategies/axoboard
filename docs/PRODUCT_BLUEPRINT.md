# AxoBoard product blueprint

## Product promise

**Build a trusted operating dashboard from the systems a company already uses—then let teams act on what they see.**

AxoBoard is not a warehouse, spreadsheet replacement, or unrestricted BI query tool. It is the governed operational layer used in daily meetings, team screens, exception handling, and performance reviews.

## Fork strategy

Do not perform a literal code fork of Murphy Dashboards yet.

Murphy's application is a valuable reference customer but currently includes a large single-tenant server, global environment credentials, SQLite state, fixed spreadsheet IDs, company-specific terminology, and custom workflows. Copying it would create the appearance of speed while baking tenant leakage and expensive rewrites into the product.

Use a **selective extraction** strategy:

1. Define tenant-safe contracts for connectors, datasets, metrics, cards, dashboards, and actions.
2. Build the AxoBoard control/data planes independently.
3. Port one proven card at a time behind those contracts.
4. Connect Murphy as the first tenant through configuration and adapters.
5. Keep Murphy-only games, commissions, and internal workflows in the Murphy repository unless they become reusable templates.

## Architecture outline

```text
Browser / TV / Embed
        │
        ▼
Experience plane
Dashboard builder · card renderer · templates · alerts · action center
        │
        ▼
Control plane
Tenants · memberships · RBAC · branding · billing · audit · feature flags
        │
        ▼
Semantic plane
Certified datasets · metric definitions · dimensions · lineage · versions
        │
        ▼
Data plane
Connector workers · OAuth/secrets · webhooks · schedules · retries · replay
        │
        ▼
Postgres metadata/serving · object storage raw payloads · Redis/queue/cache
```

Every stored row, cache key, event, job, log, and object-storage path must carry `tenant_id`. Tenant isolation tests are release blockers.

## Core data model

| Entity | Purpose |
| --- | --- |
| Tenant | Billing, data boundary, retention, security policy |
| Workspace | Department or business-unit organization within a tenant |
| User / Membership | Identity and role assignment |
| IntegrationConnection | Encrypted OAuth/token reference and health state |
| ConnectorSync | Cursor, status, counts, retry state, diagnostics |
| Dataset | Governed normalized table or view |
| MetricDefinition | Formula, grain, filters, owner, certification state |
| Dashboard / DashboardVersion | Layout, theme, audience, publish history |
| Card | Visualization/action type and placement |
| CardQuery | Dataset, metric, dimensions, filters, comparison, refresh policy |
| AlertRule | Condition, schedule, dedupe, recipients, escalation |
| ActionDefinition / ActionRun | Governed writeback or automation trigger |
| AuditEvent | Administrative and data-affecting activity |
| UsageLedger | API calls, rows, refreshes, storage, AI/compute cost |

## Card contract

Every card should be configuration—not bespoke React code:

```json
{
  "type": "metric",
  "title": "Net sales today",
  "datasetId": "sales_orders",
  "metricId": "net_sales",
  "dimensions": [],
  "filters": [{ "field": "paid_at", "operator": "today" }],
  "comparison": { "mode": "rolling_average", "days": 30 },
  "display": { "format": "currency", "showSparkline": true },
  "freshness": { "maxAgeSeconds": 300 },
  "actions": [{ "type": "open_dashboard", "target": "order_exceptions" }]
}
```

Custom cards are a controlled SDK/plugin capability, not arbitrary customer JavaScript.

## Builder experience

The minimum complete builder loop is:

1. Choose a certified dataset or template.
2. Add a card type.
3. Select metric, dimensions, filters, and time comparison.
4. Preview with real tenant data.
5. Place and resize on a responsive grid.
6. Validate permissions, freshness, and definition.
7. Save a draft, review changes, and publish a version.
8. Roll back to an earlier version.

Roles:

- Viewer: view, filter, export if allowed.
- Operator: viewer plus approved card actions.
- Editor: compose dashboards from certified assets.
- Data steward: create/certify datasets and metrics.
- Admin: integrations, users, branding, security, billing.

## Integration priorities

### Launch connectors

1. HubSpot
2. Shopify
3. Google Sheets
4. PostgreSQL
5. Generic REST API / webhook intake

These cover Murphy's proven shape while remaining useful across the initial ICP.

### Next connectors

6. Salesforce
7. QuickBooks Online
8. Stripe
9. Microsoft Excel / OneDrive
10. Dialpad or RingCentral
11. Slack and Microsoft Teams destinations

Do not launch with twenty shallow connectors. Five observable, replayable connectors are better than fifty brittle OAuth wrappers.

## Connector contract

Each connector must implement:

- OAuth/token setup and scoped permission display;
- connection test;
- schema discovery;
- incremental cursor or webhook ingestion;
- deterministic normalization;
- rate-limit aware retries with exponential backoff;
- idempotency and replay;
- health, freshness, record counts, and error diagnostics;
- credential rotation and disconnect/data-deletion behavior;
- sandboxed contract tests against fixtures.

## Suggested technical foundation

- TypeScript monorepo with independently deployable web, API, and worker packages.
- React application with a schema-driven card renderer and accessible grid builder.
- PostgreSQL for tenant metadata, normalized serving tables, and row-level tenant policies.
- Redis-compatible queue/cache for sync jobs, dedupe, locks, and live refresh fanout.
- Object storage for encrypted raw payload replay and exports.
- Managed secrets/KMS; never store connector tokens in ordinary configuration rows.
- OpenTelemetry traces, structured logs, per-tenant usage counters, and connector SLOs.
- Stripe for billing after pricing validation; avoid billing complexity during the first design-partner pilot.

## Delivery roadmap

### Phase 0 — Product boundary and contracts (2–3 weeks)

- buyer interviews and design-partner agreements;
- tenant threat model and data classification;
- card, metric, dataset, and connector schemas;
- design system and working builder prototype;
- migration inventory of Murphy capabilities.

Exit: one Murphy card can be represented entirely by generic configuration.

### Phase 1 — Secure pilot foundation (8–12 weeks, 2 experienced engineers)

- tenancy, authentication, roles, audit foundation;
- Postgres metadata and worker infrastructure;
- HubSpot, Shopify, and Google Sheets connectors;
- metric, trend, table, goal, status, and text cards;
- dashboard draft/publish/version/rollback;
- responsive viewer and TV mode;
- integration health and freshness UI.

Exit: Murphy plus one external partner can operate in isolated tenants.

### Phase 2 — Paid design partners (6–10 weeks)

- templates, alerts, scheduled delivery, API/webhook intake;
- white-label theme/logo/domain;
- action cards with approvals and audit;
- usage metering and plan enforcement;
- self-service onboarding and diagnostics.

Exit: three paying external partners and 70% reusable configuration.

### Phase 3 — Corporate readiness (3–6 additional months)

- SAML/OIDC SSO, SCIM, granular roles;
- security review package, DPA, retention/deletion tooling;
- backup/restore drills, incident runbooks, SLO reporting;
- multi-region/data residency if demanded;
- custom connector SDK and marketplace governance.

## What not to build yet

- a general SQL IDE;
- arbitrary customer JavaScript cards;
- dozens of connectors;
- AI-generated metrics without deterministic review;
- mobile-native apps;
- full data warehouse functionality;
- a public plugin marketplace;
- per-customer code branches.

## Success instrumentation

Track from the first tenant:

- credential-to-first-dashboard time;
- percent of cards using certified metrics;
- dashboard weekly active viewers;
- alert acknowledgement and action completion;
- connector freshness SLO and retry rate;
- implementation/support hours per tenant;
- percent of deployment assembled without custom code;
- infrastructure and third-party cost per tenant;
- expansion, churn, and gross margin.

## Top failure modes and detection

1. **Cross-tenant leakage** — automated tenant-isolation tests on every repository/query/cache path; canary records per tenant.
2. **Silent stale data** — freshness badge on every card, connector SLO alerts, visible last-good sync, and replay queue.
3. **Metric definition drift** — certified metric registry, owners, version history, impact preview, and dashboard dependency graph.
4. **Connector cost explosion** — per-tenant call/row ledger, rate-limit telemetry, incremental sync coverage, and pricing quotas.
5. **Customization trap** — report custom-code percentage and implementation hours before approving any customer request.
