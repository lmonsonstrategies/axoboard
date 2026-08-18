# AxoBoard automation operations

This runbook covers the first production automation slice: certified scalar KPI events evaluated into versioned rules and persisted customer-branded TV celebrations.

## Runtime model

```text
certified metric snapshot
  -> immutable domain event + PostgreSQL outbox
  -> leased rule evaluator
  -> immutable automation run
  -> independent leased action attempt
  -> persistent TV event feed
  -> paired display polling
```

PostgreSQL is the queue and source of truth. Leases, idempotency keys, and unique tenant-scoped constraints make worker retries and multiple web replicas safe without Redis.

## Authorization

| Capability | Owner/Admin | Editor | Viewer |
| --- | --- | --- | --- |
| Read rules and runs | Yes | Yes | No |
| Create and edit drafts | Yes | Yes | No |
| Dry-run drafts | Yes | Yes | No |
| Publish, pause, resume, or archive | Yes | No | No |
| Retry failed action attempts | Yes | No | No |
| Manage TV displays and destinations | Yes | No | No |

Viewer bootstrap payloads exclude automation, display, event-ledger, connection, and source-control-plane records.

## Configuration

```bash
AXOBOARD_ENGAGEMENT_CORE_ENABLED=true
AXOBOARD_AUTOMATION_CORE_ENABLED=true
AXOBOARD_AUTOMATION_WORKER_ENABLED=true
AXOBOARD_AUTOMATION_WORKER_INTERVAL_MS=5000
```

- Set `AXOBOARD_AUTOMATION_CORE_ENABLED=false` to disable the automation API, evaluator, and TV feed.
- Set `AXOBOARD_AUTOMATION_WORKER_ENABLED=false` to stop new evaluations and deliveries while preserving APIs and history.
- The interval is clamped to 1–60 seconds. Five seconds is the initial production default.

## Health and semantics

`GET /healthz` reports:

- `automationCore`: whether the runtime is configured.
- `automationWorker`: `not_configured`, `disabled`, `dependency_unavailable`, `starting`, `healthy`, `degraded`, or `stale`.
- `automationWorkerLastStartedAt`, `automationWorkerLastCompletedAt`, and `automationWorkerLastErrorAt`: evidence for the most recent worker tick.

Worker health is freshness-based. An old successful tick does not make a hung worker appear healthy.

An action marked `succeeded` means the event is durably available in the paired-display feed. It does not claim that a television rendered or acknowledged the overlay. Playback acknowledgements are outside this release.

## Rule lifecycle

1. An editor creates or changes a mutable draft.
2. A dry run evaluates retained snapshots without creating action attempts.
3. An owner/admin publishes the exact reviewed revision as an immutable version.
4. Only events after the activation cursor are eligible.
5. Pause stops future evaluations; resume reactivates the published version.
6. Archive stops the rule permanently while retaining versions, runs, attempts, and audit history.

Rules bind to certified metric IDs, never rendered card IDs. Goal-percentage rules cannot publish without a current active goal. Deleting a KPI is blocked until every linked automation is archived.

## Incident response

### Worker is stale or degraded

1. Check `/healthz` timestamps and application logs for `[automation-worker]`.
2. Inspect Runs for failed/dead-letter decisions and individual action errors.
3. Confirm PostgreSQL is healthy and the latest migration checksum matches the deployed code.
4. Restart the Railway service once. PostgreSQL leases recover expired work safely.
5. If failures continue, set `AXOBOARD_AUTOMATION_WORKER_ENABLED=false`, restart, and investigate without creating new attempts.

### Duplicate-action concern

1. Do not manually replay the source event.
2. Find the run and action idempotency keys in PostgreSQL/audit evidence.
3. Confirm the unique workspace + source-event/run/action constraints still exist.
4. Retry only the failed action through the admin API/UI; never recreate the rule to force delivery.

### Stale or changed metric contract

Freshness guardrails suppress stale snapshots. A material metric contract change degrades the rule and requires an authorized user to review and publish a new version before resume.

## Current product boundary

- Supported metrics: certified scalar Scorecard, Goal Pace, and Gauge KPIs.
- Supported action: persistent customer-branded TV celebration.
- Structured cards require a dedicated scalar KPI for the exact item/stage/field.
- Slack, email, sounds, competition scoring, delivery acknowledgements, and dashboard publishing approvals remain intentionally unavailable.

## Rollback

Disable the worker first, then the automation core if needed. Migration `013` is additive; do not drop its tables during an incident. Roll back application code through the guarded release workflow and retain automation history for diagnosis.
