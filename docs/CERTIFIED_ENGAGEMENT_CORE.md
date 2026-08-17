# Certified Engagement Core

## Scope

This release turns the approved engagement wireframe into a production vertical slice:

- provider-neutral certified metric definitions and trust lineage;
- deterministic Goal Pace and Gauge evaluations;
- idempotent milestone domain events and a transactional outbox;
- immutable customer brand packages used by the TV preview and event ledger.

Competition scoring and external celebration delivery remain intentionally out of scope. They can consume the domain-event/outbox contract in a later release.

## Write path

`Google snapshot transaction -> semantic metric -> goal evaluation -> milestone event -> outbox row`

Snapshot, evaluation, event, and outbox writes share one PostgreSQL transaction. Each milestone uses the key
`goal:{goal_id}:v{goal_version}:{period_key}:milestone:{threshold}`, so retries cannot create duplicate wins.

## Trust contract

`GET /api/axoboard/metrics/:mappingId/trust` returns only the authenticated workspace's metric definition, source lineage, freshness, latest snapshot, goal, and evaluation. Certification is suspended when a mapping is deleted, its source degrades, or the provider disconnects.

`GET /api/axoboard/events` returns the authenticated workspace's immutable event ledger and delivery state. Tenant IDs are enforced in every lookup and composite foreign key.

## Goal semantics

- Direction: `higher_is_better` or `lower_is_better`
- Calendar: `calendar_days` or `weekdays`
- Period: day, week, month, or year
- Timezone: stored IANA timezone and evaluated with `Intl.DateTimeFormat`
- Output: attainment, projected finish, required daily pace, status, and next milestone

Lower-is-better goals report the required daily reduction and do not emit cumulative percentage milestones.

## Brand contract

Every workspace receives an immutable published brand package. Events capture its version at creation time, so historical ledger entries and future deliveries retain the customer identity that was active when the event occurred. AxoBoard branding remains in authenticated admin chrome; the TV surface uses the customer workspace identity.

## Operations and rollback

Set `AXOBOARD_ENGAGEMENT_CORE_ENABLED=false` and restart the web service to disable the new trust/event API and snapshot engagement writes without removing existing data. Re-enable after diagnosis. Migration `011_certified_engagement_core.sql` is additive; do not drop its tables during an incident.

The outbox is intentionally delivery-neutral in this slice. Pending rows are observable but no external message is sent.
