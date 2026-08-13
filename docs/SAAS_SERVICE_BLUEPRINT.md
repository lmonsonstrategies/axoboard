# AxoBoard commercial service blueprint

Status: product and production contract  
Updated: 2026-08-12

## Product promise

AxoBoard is a customer-configurable performance and celebration service. Customers bring trusted business data, publish branded dashboards to web/mobile/TV, and connect measurable outcomes to recognition, sounds, alerts, and team games.

The sellable outcome is not “access to charts.” It is a branded, trusted team-performance system that reaches first value quickly and remains understandable without custom engineering.

## Customer journey

1. Create an isolated workspace and owner account.
2. Apply logo, colors, language, timezone, and accessibility defaults.
3. Connect one trusted source through scoped OAuth.
4. Install an outcome recipe and map the required metrics.
5. Preview and publish the first dashboard.
6. Invite viewers, editors, managers, and admins.
7. Pair a display and test an alert/celebration rule.
8. Monitor freshness, usage, service health, and outcomes from Workspace Admin.

Target: first published, trusted KPI in under ten minutes.

## Service surfaces

- **Workspace Admin:** onboarding, launch readiness, members, roles, plan usage, billing, service health, and support.
- **Dashboards:** versioned draft, preview, publish, and rollback.
- **Integrations:** tenant-scoped connections, mappings, scopes, health, and revocation.
- **Displays:** short-lived pairing, device-bound access, schedules, heartbeat, and recovery.
- **Automations:** deterministic rule evaluation, dry runs, guardrails, destination retries, and audit history.
- **Celebrations and Sounds:** controlled recognition with quiet hours, licensing, scanning, and accessible motion/audio defaults.
- **Team Competitions:** customer-owned competition presets, terminology, scoring, art, audio, and brand assets.
- **Brand Studio:** one versioned customer theme across web, mobile, shares, TV, celebrations, and games.

## Tenant architecture

Every customer-owned record carries a non-null `tenant_id`. Authorization resolves the session's active tenant and role before any query, cache lookup, asset read, background job, export, or websocket subscription.

Minimum production entities:

- `Tenant`, `TenantDomain`, `TenantPolicy`
- `User`, `Membership`, `Invitation`, `RoleGrant`
- `Subscription`, `PlanEntitlement`, `UsageLedger`, `InvoiceReference`
- `Connection`, `CredentialReference`, `Dataset`, `MetricDefinition`, `MetricSnapshot`
- `Dashboard`, `DashboardVersion`, `CardDefinition`, `PublishEvent`
- `DisplayScreen`, `DashboardLoop`, `ScreenHeartbeat`
- `AutomationRule`, `AutomationRuleVersion`, `AutomationRun`, `ActionAttempt`
- `BrandTheme`, `CelebrationTemplate`, `SoundAsset`, `GamePreset`, `ScoreEvent`
- `ShareGrant`, `SnapshotSchedule`, `AuditEvent`, `SupportCase`

### Isolation requirements

- Tenant scope is enforced in repository/service code and database row-level policies where supported.
- Object storage keys begin with an opaque tenant identifier and use signed short-lived access.
- Cache and queue keys include tenant and resource version.
- Background workers reauthorize tenant/resource state before side effects.
- Exports and support bundles use field allowlists and explicit redaction.
- Cross-tenant negative tests run in CI for every sensitive route.

## Customer roles

| Role | Capabilities |
| --- | --- |
| Viewer | View published dashboards and permitted drilldowns |
| Editor | Create drafts and edit dashboards, themes, sounds, and game presets |
| Automation manager | Draft/test rules and inspect run history |
| Publisher | Publish and roll back dashboards, loops, themes, and rules |
| Workspace admin | Connections, users, policies, displays, shares, and usage |
| Owner | Subscription, billing ownership, owner transfer, and workspace closure |

High-risk permissions remain separate. “Editor” must not silently imply billing, connection, export, or user-administration access.

## Commercial packaging

The launch pricing hypothesis is now defined in `docs/PRICING_AND_REVENUE_MODEL.md` and must still be validated with design partners. Packaging stays easy to explain:

- one primary unit: active workspace;
- capacity entitlements: members, displays, data sources, refresh frequency, automation volume, and retained history;
- premium governance: SSO, advanced roles, audit retention, custom domains, contracted support, and higher limits;
- no surprise overages: warn, provide usage detail, and require an explicit policy before charging beyond entitlement.

Plan families and launch prices:

- **Starter — $99 monthly / $79 annual equivalent:** core dashboards, one display, basic alerts, starter celebrations;
- **Growth — $249 monthly / $199 annual equivalent:** displays, automations, custom celebrations, sounds, branding, and Team Competitions;
- **Scale — $599 monthly / $499 annual equivalent:** multiple workspaces, advanced governance, audit retention, larger limits, and priority support;
- **Enterprise — from $1,500 monthly:** SSO, SLA, contracted onboarding, limits, integrations, and service terms.

Keep unlimited dashboards and viewers on every paid plan. Do not launch self-serve public checkout until willingness-to-pay, support load, connector costs, and onboarding effort have been measured with paid design partners.

## Billing boundary

Use a billing provider for checkout, taxes, payment methods, invoices, and subscription lifecycle. AxoBoard stores provider customer/subscription references, entitlements, and a local append-only usage ledger—not raw card data.

Webhook processing must be signed, idempotent, replay-safe, and auditable. Losing a webhook must not immediately delete customer access or data. Apply a configurable grace period and surface actionable status to the owner.

## Customer onboarding

The launch checklist should be event-driven, not a hardcoded progress bar. Each item completes from a verified event:

- workspace created;
- brand version published;
- healthy connection with a successful sample read;
- first metric certified;
- dashboard version published;
- member invitation accepted;
- display heartbeat received;
- automation dry run passed.

Incomplete steps link directly to the correct workflow. Completion is reversible when a dependency becomes unhealthy.

## Customer support and operations

- Show customer-facing service health, sync freshness, screen heartbeat, and automation failures.
- Create redacted support bundles only after customer consent.
- Never include OAuth tokens, passwords, raw private assets, or unrelated tenant data.
- Link incidents to affected tenants and resources without exposing one customer to another.
- Define response targets by plan only after staffing and alert coverage support them.
- Provide data export, retention, and workspace-closure workflows before general availability.

## Brand architecture

AxoBoard product chrome remains leucistic pink, warm white, aquatic blue, and restrained GFP green. Customer content can be fully rebranded within accessible constraints.

Keep two layers separate:

1. **AxoBoard service identity:** sign-in, account, billing, support, legal, and system safety states.
2. **Customer workspace identity:** dashboards, shares, displays, celebrations, sounds, and games.

A customer theme must never obscure service security warnings, billing state, permissions, or accessibility controls.

## Persistence migration

The interactive beta stores non-sensitive draft preferences in browser `localStorage` under `axoboard.beta.service.v1`. This is for beta continuity only.

Production migration:

1. Move state to authenticated tenant-scoped APIs.
2. Store immutable published versions and mutable drafts separately.
3. Add optimistic concurrency/version checks.
4. Encrypt credential references and sensitive configuration.
5. Emit audit events for create, update, publish, rollback, invite, role, billing, and export operations.
6. Remove browser storage as the source of truth; retain only safe UI preferences and offline draft buffers.

## Fastest production MVP

1. Tenant, user, membership, invitation, and role model.
2. Workspace onboarding and BrandTheme draft/publish.
3. Google Sheets OAuth plus one certified metric.
4. Dashboard draft/publish/version/rollback with responsive viewer.
5. Subscription entitlements and usage ledger, initially with manual design-partner billing.
6. Screen pairing/heartbeat and one deterministic alert-to-celebration action.
7. Support diagnostics, audit log, export, retention, and closure runbooks.

## Launch gates

- Cross-tenant access tests pass for API, assets, queues, caches, exports, and shares.
- Billing events are idempotent and entitlement changes are recoverable.
- All customer workflows pass mobile and keyboard QA.
- OAuth revoke/reconnect and session-expiry recovery preserve safe drafts.
- Published versions can roll back without custom intervention.
- Errors are customer-visible, actionable, and linked to support diagnostics.
- Backups and restore tests cover tenant metadata, configurations, and versioned definitions.
- Terms, privacy, data-processing, retention, deletion, and acceptable-use policies are reviewed before public sale.

## Top failure modes

1. **Tenant leakage:** detect with negative authorization tests, tenant-tagged audit events, and strict asset/cache key review.
2. **Unprofitable customer complexity:** detect onboarding time, support hours, connector incidents, and infrastructure cost per workspace.
3. **Billing/entitlement drift:** reconcile provider subscriptions against the local entitlement and usage ledgers daily.

## Cost controls

- Cache published viewer payloads; do not call providers for each view.
- Normalize a metric snapshot once and reuse it for cards, alerts, celebrations, exports, and games.
- Queue snapshots, scans, syncs, and side effects with stable idempotency keys.
- Meter provider calls, rendering, storage, automation actions, and retained history per tenant.
- Prefer five deep connectors over a broad support-heavy catalog during the design-partner phase.
