# AxoBoard market analysis

Research date: 2026-08-11

## Executive verdict

AxoBoard is viable only if it is sold as an **operational command center**, not another generic dashboard builder.

The generic dashboard market is mature and price-compressed. Power BI is $14–$24 per user per month, Metabase starts around $100 per month plus users, and polished KPI dashboard products cluster around $100–$400 per month. A product offering charts, filters, connectors, and white-label colors alone has no credible moat.

The stronger wedge is the problem Murphy Dashboards already validates: businesses have operational data scattered across HubSpot, Shopify, spreadsheets, phone systems, accounting tools, and internal workflows. They need trusted metrics, TV-ready visibility, alerts, ownership, and actions without hiring a data team.

**Recommended ICP:** 50–500 employee revenue/service organizations using HubSpot plus two or more operational systems, with no dedicated analytics engineering team and a visible spreadsheet/reporting burden.

**Recommended initial buyer:** VP Operations, Revenue Operations leader, Customer Service leader, or COO with authority over a $10K–$30K annual software budget.

## Competitive pricing benchmark

| Product | Current public price signal | What customers buy | Implication for AxoBoard |
| --- | ---: | --- | --- |
| [Geckoboard](https://www.geckoboard.com/pricing/) | $119/mo Essentials; $399/mo Performance; enterprise custom | Fast KPI/TV dashboards, 90+ sources, unlimited viewers | Sets the upper bound for dashboards without deep workflow value. |
| [Databox](https://databox.com/pricing) | $64/mo Analyst; $159/mo Pro; $399/mo Growth; custom enterprise | Unlimited dashboards/users on team plans, datasets, forecasts, AI, source-based pricing | Extremely strong feature/price pressure. White labeling alone cannot justify premium pricing. |
| [Metabase](https://www.metabase.com/pricing/) | $100/mo + $6/user Starter; $575/mo + $12/user Pro | General BI, SQL/semantic models, embedding | AxoBoard should not compete for analysts or warehouse-native BI workloads. |
| [Power BI](https://www.microsoft.com/en-us/power-platform/products/power-bi/pricing) | $14/user/mo Pro; $24/user/mo Premium Per User | Enterprise BI, Microsoft ecosystem, complex modeling | Impossible to beat on raw BI breadth or seat price. Compete on deployment speed and operational usability. |
| [Screenful](https://screenful.com/pricing) | $39/$79/$149/$399 per month | Project dashboards and scheduled reports with unlimited users | Confirms that lightweight visualization is commodity-priced. |

## Market gap worth attacking

Most dashboard products stop at visualization. AxoBoard should own the layer between systems of record and the daily operating meeting:

1. **Opinionated operational templates** — sales floor, service queue, pipeline health, revenue pulse, order exceptions, rep scorecards.
2. **Metric trust** — every card shows source, refresh time, definition, owner, and quality state.
3. **Action cards** — acknowledge, assign, retry, open source record, trigger workflow, or create follow-up without leaving the dashboard.
4. **TV and meeting modes** — rotation, density presets, audible/visual events, goal pacing, and scheduled layouts.
5. **Managed connectors** — reliable ingestion, normalization, retries, rate-limit handling, and replay rather than a thin API proxy.
6. **Governed self-service** — users compose approved metrics and datasets; they do not gain unrestricted access to credentials or raw production data.

## Recommended pricing

Charge by workspace capability, connected accounts, refresh/service level, and data volume. Do **not** charge per viewer; operations dashboards are frequently displayed on TVs or shared broadly.

| Plan | Monthly list price | Included | Intended customer |
| --- | ---: | --- | --- |
| Team | **$299/mo** | 3 connected accounts, 5 dashboards, 3 editors, unlimited viewers, hourly refresh, templates, email reports | Small team proving the workflow |
| Operations | **$899/mo** | 10 connections, 20 dashboards, 15 editors, unlimited viewers, 5-minute refresh, alerts, TV mode, custom branding, API/webhooks | Core mid-market offer |
| Business | **$1,999/mo** | 25 connections, unlimited dashboards, 50 editors, SSO, audit log, environments, advanced permissions, priority support | Multi-department organization |
| Enterprise | **$3,500–$8,000+/mo** | Contracted volume, SLA, dedicated infrastructure/data region, SCIM, security reviews, custom connectors, named success owner | Regulated or large corporate deployment |

One-time onboarding should not be hidden inside subscription pricing:

- Team: $1,500 assisted setup
- Operations: $5,000 implementation
- Business: $10,000–$20,000 implementation
- Enterprise: scoped statement of work

For the first three external design partners, offer **$500/mo plus $2,500 setup for six months**, with explicit product-feedback commitments. Do not offer free custom builds. Murphy is proof of function, not proof that unrelated companies will pay.

Annual contracts should receive at most a 15% discount. Custom connectors, metric modeling, and data cleanup are professional services until proven reusable.

## Why this can command more than Geckoboard or Databox

Only if AxoBoard measurably replaces recurring work or catches costly failures. The sales case should quantify:

- hours removed from weekly report assembly;
- faster detection of revenue/service exceptions;
- reduced tool switching during operating meetings;
- fewer unowned tickets, orders, leads, or integration failures;
- faster onboarding of managers into trusted operating metrics.

If a prospect only wants charts, recommend Power BI, Databox, or Metabase. That honesty protects margin and product focus.

## Critical risks

### 1. Connector maintenance becomes the company

OAuth changes, API versions, scopes, pagination, rate limits, webhooks, and customer-specific schemas create permanent support cost. Each connector needs an owner, health telemetry, replay, contract tests, and a deprecation policy.

### 2. “Self-service” can destroy metric trust

Letting every user write arbitrary queries creates multiple definitions of revenue, conversion, and activity. Self-service must use certified datasets and metric definitions, with drafts, review, versioning, and lineage.

### 3. White labeling is not differentiation

Logos, domains, and colors are table stakes and often increase support complexity. Charge for them, but do not build the strategy around them.

### 4. Enterprise readiness is expensive

SSO, SCIM, audit trails, backups, tenant isolation, data deletion, incident response, vulnerability management, DPAs, and security questionnaires are required before credible enterprise selling. A polished dashboard is perhaps 20% of the product.

### 5. Murphy-specific success may not generalize

Murphy Dashboards contains custom operating logic, game mechanics, spreadsheets, and workflows. Validate three external customers in one narrow ICP before adding broad connector coverage.

### 6. Services revenue can hide weak product-market fit

If every customer requires unique formulas, pages, and integrations, AxoBoard is an agency with software—not SaaS. Track implementation hours, reusable configuration percentage, support hours per account, and gross margin from the first pilot.

## Validation gates

Do not fund a broad build until these gates are met:

1. Ten buyer interviews in the target ICP.
2. Three paid external design partners.
3. At least 70% of each deployment assembled from shared connectors, metrics, cards, and templates.
4. Time-to-first-trusted-dashboard under one business day after credentials are available.
5. Ongoing support below two hours per customer per month.
6. Gross revenue retention target above 90% and gross margin path above 75%.

## Name warning

“AxoBoard” is usable as a working name, but `axo.io` is already an adjacent revenue-operations software company. Run a formal trademark, domain, and search-confusion review before investing in brand assets.
