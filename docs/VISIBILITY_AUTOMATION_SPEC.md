# AxoBoard visibility and automation specification

Status: beta product contract  
Updated: 2026-08-12

## Purpose

This specification turns AxoBoard from a dashboard editor into an operational visibility system. It covers outcome recipes, TV displays, dashboard loops, secure sharing, scheduled snapshots, drilldowns, source lineage, and KPI-driven automations.

## Product principle

A KPI is not finished when it renders. It is finished when the right audience can trust it, see it where they work, understand its source, and trigger an appropriate action without duplicate noise.

## Core contracts

### OutcomeRecipe

- `id`, `tenant_id`, `name`, `description`, `version`, `status`
- compatible `connector_requirements`
- versioned `dashboard_definition`, `metric_definitions`, `goal_definitions`
- `automation_rules`, `celebration_templates`, `display_loops`
- installation produces a tenant-scoped draft and a dependency-resolution report
- upgrades are explicit migrations; customer edits are never overwritten silently

### DisplayScreen

- `id`, `tenant_id`, `name`, `location`, `timezone`, `resolution`, `device_type`
- `status`, `last_heartbeat_at`, `app_version`, `current_content_id`
- pairing uses a single-use, ten-minute code stored only as a hash
- screen tokens are tenant-scoped, device-bound, revocable, and cannot edit dashboards
- heartbeat includes current view, last successful render, sync age, and recoverable error code

### DashboardLoop

- ordered `LoopItem` records with `content_type`, `content_id`, `duration_seconds`, and transition
- active-hours schedule evaluated in the screen timezone
- published loop versions are immutable; editing creates a draft
- players retain the last-known-good loop for offline recovery
- minimum duration: 10 seconds; maximum: 15 minutes per item

### ShareGrant

- `id`, `tenant_id`, `dashboard_version_id`, `token_hash`, `created_by`
- `expires_at`, `revoked_at`, optional `passcode_hash`, optional IP policy
- `allow_drilldown`, `allow_export`, `allowed_metric_ids`
- raw tokens are shown once and never stored
- every view, drilldown, export, denial, and revocation is auditable
- source click-through always rechecks the viewer's provider permissions

### SnapshotSchedule

- destination type: Slack, Microsoft Teams, or email
- destination identifier, schedule, timezone, dashboard version, format, recipients
- rendering produces an immutable snapshot plus a plain-text KPI summary
- delivery ledger uses `schedule_id + scheduled_at + destination_id` as its idempotency key
- retries use exponential backoff, capped at three, without duplicating successful destinations

### AutomationRule

- `id`, `tenant_id`, `name`, `enabled`, `metric_id`, `metric_version`
- condition operator, threshold, evaluation window, required freshness state
- cooldown, quiet hours, audience, and escalation policy
- ordered actions: celebration, sound, Slack, Teams, email, owner task, or competition score event
- every evaluation records the input snapshot, decision, action outcomes, retries, and actor
- rule publishing requires a dry-run preview against recent metric history

### AutomationRun

- stable `event_id`, `rule_version_id`, `metric_snapshot_id`, `evaluated_at`
- outcome: ignored, suppressed, matched, partial, succeeded, or failed
- each destination has an independent idempotency key and retry state
- a replay can retry failed destinations but cannot replay successful scoring or celebrations

### MetricLineage

- provider, connection, dataset/object, field/range, filter, aggregation, timezone
- owner, definition, unit, expected grain, freshness SLO, certified status
- metric snapshots are immutable and retain source record/cell references where permitted
- drilldown fields are allowlisted and redacted before presentation
- stale, partial, rate-limited, and permission-denied states must be visibly distinct

## Primary user flows

### Install an outcome recipe

1. Select a recipe.
2. Resolve or connect required data sources.
3. Map required fields and validate sample values.
4. Preview the dashboard, goals, rules, celebrations, and loop as one draft.
5. Publish atomically or save the unresolved draft.

### Pair a display

1. Admin creates a short-lived pairing code.
2. Viewer device exchanges the code for a device token.
3. Admin names the screen, chooses timezone and loop, then previews overscan.
4. Player downloads the published loop and reports a healthy render heartbeat.

### Explain a KPI

1. Viewer opens a card.
2. AxoBoard displays value, freshness, formula, owner, definition, and source path.
3. Permitted source rows or cells appear with redacted fields.
4. Source click-through is enabled only after provider permission is verified.

### Automate an outcome

1. Admin selects a certified metric and condition.
2. Recent history previews how often it would have fired.
3. Admin chooses destinations, cooldown, quiet hours, and escalation.
4. Publish creates an immutable rule version.
5. Every run is observable and independently retryable by destination.

## Permissions

- Viewer: published dashboards and allowed drilldowns.
- Screen: published display payloads only.
- Editor: dashboard drafts, recipes, and preview.
- Automation manager: rule drafts, dry runs, and run logs.
- Publisher: publish/revert dashboards, loops, recipes, and rules.
- Tenant admin: connections, security policies, screen pairing, share grants, and revocation.

## Reliability and security

- Encrypt provider tokens at rest; never send refresh tokens to the browser or display player.
- Enforce tenant scope in every query and cache key.
- Keep last-known-good display payloads and rendered snapshots.
- Validate freshness before evaluating a rule; stale values do not trigger by default.
- Treat incoming webhooks and provider fields as untrusted data.
- Scan uploaded images/audio and retain licensing/ownership attestations.
- Audit publish, rollback, share, pairing, export, replay, and permission changes.

## Observability

Track:

- OAuth-to-first-published-KPI duration
- dashboard and loop publish success
- screen heartbeat age, render errors, and uptime
- snapshot render/delivery latency and destination failures
- automation evaluations, matches, suppressions, duplicates, retries, and action latency
- drilldown opens, source handoffs, permission denials, and exports
- recipe install completion and unresolved dependency rate

## Fastest MVP path

1. Persist versioned dashboards, metric lineage, and one Google Sheets metric.
2. Add screen pairing, one dashboard loop, heartbeat, and last-known-good cache.
3. Add a threshold rule with Slack plus celebration actions and destination-level idempotency.
4. Add secure share links and scheduled email snapshots.
5. Add HubSpot drilldown and Team Competitions scoring after permission and replay tests pass.

## Top failure modes and detection

1. **Duplicate outcomes:** detect any repeated destination idempotency key and alert when duplicate suppression rises unexpectedly.
2. **Untrusted or stale metrics:** block automation when freshness SLO fails; display stale age and last-known-good timestamp.
3. **Viewer data leakage:** run cross-tenant and field-redaction tests on every share, drilldown, export, and screen payload release.

## Cost notes

- TV viewers should use cached published payloads and lightweight heartbeats, not repeated provider calls.
- Snapshot rendering should be queued and deduplicated by schedule occurrence.
- Rule evaluation should consume normalized metric snapshots once and fan out deterministic actions.
- Connector breadth increases support cost sharply; prioritize deep Google Sheets, HubSpot, Shopify, PostgreSQL, and webhook support before a broad catalog.
