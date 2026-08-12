# AxoBoard competitive roadmap

## Competitive baseline

Geckoboard currently positions itself around self-service connections, drag-and-drop real-time dashboards, TV wallboards and loops, shared links, mobile access, scheduled Slack/Teams/email snapshots, alerts, drilldowns/source data, goals, status indicators, leaderboards, celebrations, and AI access through MCP. It advertises more than 90 integrations. Sources: [Geckoboard product overview](https://www.geckoboard.com/product/), [TV dashboards](https://www.geckoboard.com/product/tv-dashboards/), and [sharing](https://www.geckoboard.com/product/shareable-dashboards/).

AxoBoard should match the operational visibility baseline while differentiating on deep customization and emotionally resonant team behavior.

## Product wedge

**Geckoboard makes KPIs visible. AxoBoard makes progress visible, personal, and worth celebrating.**

AxoBoard differentiators:

- one theme system across dashboards, celebrations, sounds, games, and TV;
- customizable celebration rules and user-owned sound libraries;
- fully rebrandable competitive experiences through Kombat presets;
- plain-language KPI lineage and freshness built into every card;
- reusable team templates that configure data, goals, celebrations, and displays together;
- customer-controlled terminology, sprites, arenas, colors, and domains.

## Must-match capabilities

### P0 — Credible pilot

- Responsive drag/resize dashboard grid.
- Metric, goal, status, sparkline, line chart, bar chart, leaderboard, table, text, and activity-feed cards.
- Google Sheets and HubSpot self-service connectors.
- Dashboard draft, preview, publish, versions, and rollback.
- TV/full-screen viewer with overscan-safe layout.
- Source lineage, freshness, last-known-good value, and visible errors.
- Goals, thresholds, and event-driven celebrations.
- Viewer/editor/admin roles and tenant isolation.

### P1 — Competitive parity

- Share links with expiry, password/IP policy, revocation, and audit.
- Screen pairing and remote screen management.
- Dashboard loops and schedules.
- Slack, Teams, and email snapshots.
- Real-time threshold alerts with dedupe and escalation.
- Drilldown into source rows/records with permission-aware click-through.
- Folders, ownership, templates, duplicate dashboard, and bulk theme updates.
- Shopify, PostgreSQL, generic webhook/API, Salesforce, and Zendesk connectors.
- CSV/manual upload with schema validation.

### P2 — Win the category

- **Outcome recipes:** install a complete Sales Sprint, Support Pulse, or Launch Room with KPIs, goals, alerts, celebration rules, and a TV loop.
- **Behavior engine:** connect KPI thresholds to celebrations, sounds, shoutouts, Kombat scoring, and manager follow-up—not only notifications.
- **Trust layer:** certified metrics, owner, definition, freshness SLO, lineage, anomaly note, and change history on every KPI.
- **Context overlays:** teams can annotate a spike/drop directly on the dashboard so viewers know why it happened.
- **Metric contracts:** define expected grain, unit, acceptable range, and reconciliation test so silent data errors are caught.
- **Audience modes:** one source dashboard adapts detail and density for TV, rep, manager, executive, and mobile views.
- **Safe AI:** ask questions against certified metrics and lineage, with deterministic calculations and links back to source—not AI-invented KPIs.
- **Marketplace later:** governed connector and visualization SDK after isolation, review, versioning, and billing controls exist.

## Highest-leverage next additions

1. **TV screen management and dashboard loops.** It makes AxoBoard part of the physical workplace and is required for real Geckoboard replacement.
2. **Threshold alerts plus celebration automation.** The same rule should route Slack/Teams alerts, play a celebration, and affect Kombat scoring with idempotent event handling.
3. **Drilldown and source lineage.** A KPI must answer “where did this number come from?” and “which records changed it?”
4. **Template recipes.** Sell outcomes instead of blank canvases: Sales Daily, Pipeline Health, Concierge Pulse, and Executive Weekly.
5. **Share/snapshot destinations.** View-only links, Slack/Teams/email snapshots, and mobile-friendly views extend visibility beyond the TV.

## Beta prototype coverage

The current interactive beta now demonstrates all five highest-leverage additions:

- remote TV screen management, device heartbeat state, scheduled sleep, and dashboard loops;
- threshold rules that fan out to Slack/email, celebrations, custom sounds, and Kombat scoring;
- KPI drilldowns with freshness, source path, definition, owner, formula, and underlying records;
- installable outcome recipes for Sales Daily Command, Pipeline Health, and Concierge Pulse;
- secure live links, Slack/Teams/email snapshot scheduling, and scoped embed code.

These are interaction contracts, not production integrations. Production behavior is defined in [the visibility and automation specification](VISIBILITY_AUTOMATION_SPEC.md).

## What not to chase yet

- Ninety shallow connectors.
- A general SQL/BI exploration environment.
- AI-generated formulas without review and deterministic tests.
- A public plugin marketplace.
- Native mobile applications.
- Per-customer code branches.

Five observable connectors and ten excellent cards will beat a large brittle catalog during the design-partner phase.

## Success measures

- Median OAuth-to-first-published-KPI time under ten minutes.
- At least 70% of pilot dashboards assembled without custom code.
- More than 95% of viewed KPIs within their freshness SLO.
- Weekly viewer reach and TV screen uptime.
- Celebration acknowledgement/replay rate without mute growth.
- Alert-to-action time.
- Connector support hours per tenant.
- Percentage of KPI cards with owner, definition, lineage, and goal.
