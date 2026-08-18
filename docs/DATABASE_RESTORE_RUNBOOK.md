# AxoBoard database restore runbook

This runbook verifies that an AxoBoard PostgreSQL backup can be restored into a separate database without touching production. A restore drill is a release gate for the first managed corporate pilot and must be repeated at least quarterly.

## Safety boundary

- Never restore into the production database.
- Create a new, explicitly named restore target for every drill.
- Keep sync and automation workers disabled while validating the restored copy.
- Store the dump only in encrypted, access-controlled storage and remove it according to the backup-retention policy.
- Record the source backup timestamp, PostgreSQL version, dump checksum, start/end times, validation result, and operator.

## Required environment

Set these values in the operator shell or secret manager. Do not commit them.

```bash
export AXOBOARD_SOURCE_DATABASE_URL='postgresql://...'
export AXOBOARD_RESTORE_DATABASE_URL='postgresql://.../axoboard_restore_YYYYMMDD'
export AXOBOARD_RESTORE_DUMP='/tmp/axoboard_restore_YYYYMMDD.dump'
```

The restore URL must point to a new disposable database, never the source database. Confirm the two URLs identify different database names and hosts before continuing.

## Backup and restore

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --dbname="$AXOBOARD_SOURCE_DATABASE_URL" \
  --file="$AXOBOARD_RESTORE_DUMP"

sha256sum "$AXOBOARD_RESTORE_DUMP"

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname="$AXOBOARD_RESTORE_DATABASE_URL" \
  "$AXOBOARD_RESTORE_DUMP"
```

Do not use `--clean` against a shared or previously used database. If the restore target is not empty, stop and create a new target.

## Structural validation

Run each query against the restored database:

```sql
SELECT COUNT(*) AS applied_migrations, MAX(name) AS latest_migration
FROM schema_migrations;

SELECT
  (SELECT COUNT(*) FROM workspaces) AS workspaces,
  (SELECT COUNT(*) FROM memberships) AS memberships,
  (SELECT COUNT(*) FROM kpi_mappings) AS kpis,
  (SELECT COUNT(*) FROM metric_snapshots) AS snapshots,
  (SELECT COUNT(*) FROM automation_rules) AS automation_rules,
  (SELECT COUNT(*) FROM automation_runs) AS automation_runs;

SELECT COUNT(*) AS orphaned_memberships
FROM memberships m
LEFT JOIN workspaces w ON w.id = m.workspace_id
LEFT JOIN users u ON u.id = m.user_id
WHERE w.id IS NULL OR u.id IS NULL;

SELECT COUNT(*) AS cross_tenant_automation_rows
FROM automation_runs r
JOIN automation_rules ar ON ar.id = r.rule_id
WHERE ar.workspace_id <> r.workspace_id;
```

Expected results:

- The latest migration matches the release candidate.
- Restored entity counts match the source backup manifest.
- Both integrity queries return `0`.

## Application validation

Point a disposable AxoBoard process at the restored database with all outbound work disabled:

```bash
DATABASE_URL="$AXOBOARD_RESTORE_DATABASE_URL" \
AXOBOARD_DISABLE_SYNC_SCHEDULER=true \
AXOBOARD_AUTOMATION_WORKER_ENABLED=false \
PORT=18080 \
npm start
```

Verify:

1. `/healthz` returns `200` and reports the database as `healthy`.
2. An authenticated owner can load their workspace, KPIs, displays, automation rules, and run history.
3. A viewer cannot mutate displays, sources, KPIs, or automations.
4. No sync, automation evaluation, or outbound action starts during the drill.

## Completion and cleanup

Record the validation evidence before removing the disposable restore database and local dump. Cleanup must target the exact drill database and dump path captured above; never use a wildcard.

## Drill record

| Date | Scope | Source | Result | Evidence |
| --- | --- | --- | --- | --- |
| 2026-08-17 | Frozen candidate through migration `013`; two synthetic tenants plus certified metric, published automation version, run, action, attempt, destination, outbox, and audit lineage | Disposable PostgreSQL `17.11` container | **Passed** | 13/13 migration checksums current; source/target manifests identical; 29 orphan checks and 19 cross-tenant checks returned `0`; restored `/healthz` returned HTTP `200` |

## 2026-08-17 final release-candidate drill evidence

The drill ran entirely against the disposable local container `axoboard-release-pg-20260817`; it did not access production or customer data. UTC crossed midnight during the local 2026-08-17 release session.

### Artifacts and timing

- Operator: AxoBoard guarded release workflow
- PostgreSQL: `17.11`; Node.js: `v24.18.0`
- Drill window: `2026-08-18T01:42:56Z` through `2026-08-18T01:47:56Z`
- Source database: `axoboard_restore_source_final_20260817`
- Restore target: `axoboard_restore_target_final_20260817`
- Both new databases created in `186 ms`; the target had `0` public tables before restore
- Dump: container path `/tmp/axoboard_restore_final_20260817.dump`
- Dump duration: `177 ms`; size: `125816` bytes
- Dump SHA-256: `930ea3305d25d3f5c19fbe1985387eb74b2136e544233b23dbee2b5152094c96`
- Restore duration: `383 ms`; the target had `29` public tables after restore

The source app applied migrations `001` through `013`. Database checksums for all 13 migrations matched the current files byte-for-byte before the dump and again after restore. The latest migration was `013_production_automation_core.sql`, checksum `ab0eaf18683c80e06108e762190a7907836409117be8d4601890e041b82d6dbb`.

### Commands used

The password was recovered into `AXO_TEST_PASS` from the disposable container configuration and was never printed. Database creation used explicit names and no `DROP` or `--clean` operation.

```bash
docker exec axoboard-release-pg-20260817 createdb -U postgres \
  axoboard_restore_source_final_20260817
docker exec axoboard-release-pg-20260817 createdb -U postgres \
  axoboard_restore_target_final_20260817

docker exec axoboard-release-pg-20260817 pg_dump -U postgres \
  --format=custom --no-owner --no-privileges \
  --dbname=axoboard_restore_source_final_20260817 \
  --file=/tmp/axoboard_restore_final_20260817.dump

docker exec axoboard-release-pg-20260817 sha256sum \
  /tmp/axoboard_restore_final_20260817.dump

docker exec axoboard-release-pg-20260817 pg_restore -U postgres \
  --exit-on-error --no-owner --no-privileges \
  --dbname=axoboard_restore_target_final_20260817 \
  /tmp/axoboard_restore_final_20260817.dump
```

The restored app booted with outbound work disabled:

```bash
DATABASE_URL="postgresql://postgres:${AXO_TEST_PASS}@127.0.0.1:55439/axoboard_restore_target_final_20260817" \
NODE_ENV=test \
APP_BASE_URL=http://127.0.0.1:18083 \
PORT=18083 \
AXOBOARD_DISABLE_SYNC_SCHEDULER=true \
AXOBOARD_AUTOMATION_WORKER_ENABLED=false \
npm start
```

### Row-count manifest

Every source count exactly matched its restored-target count:

| Table | Source | Target |
| --- | ---: | ---: |
| `schema_migrations` | 13 | 13 |
| `users` | 2 | 2 |
| `workspaces` | 2 | 2 |
| `memberships` | 2 | 2 |
| `integration_connections` | 2 | 2 |
| `kpi_mappings` | 2 | 2 |
| `metric_definitions` | 2 | 2 |
| `metric_snapshots` | 2 | 2 |
| `domain_events` | 2 | 2 |
| `event_outbox` | 1 | 1 |
| `automation_destinations` | 1 | 1 |
| `automation_rules` | 1 | 1 |
| `automation_rule_versions` | 1 | 1 |
| `automation_actions` | 1 | 1 |
| `automation_rule_state` | 1 | 1 |
| `automation_runs` | 1 | 1 |
| `automation_action_attempts` | 1 | 1 |
| `audit_events` | 1 | 1 |

The restored lineage joined successfully as one certified metric -> published rule version `1` revision `2` -> action -> succeeded run -> succeeded attempt -> `Restore Drill TV` destination.

### Integrity and application result

- All 29 targeted orphan checks returned `0`. Coverage included workspace/user membership, connection/KPI/metric/snapshot/event/outbox, rule/version/action/destination/state, run/attempt, and audit references.
- All 19 cross-workspace lineage checks returned `0`. Coverage included source-to-metric lineage plus every automation rule, version, action, destination, run, attempt, event, and snapshot link.
- The restored process logged `database ready` and listened on `0.0.0.0:18083` without applying or altering a migration; the health probe used `127.0.0.1:18083`.
- At `2026-08-18T01:47:56Z`, `GET /healthz` returned HTTP `200` with `ok: true`, `database: healthy`, `automationCore: configured`, `automationEventProducer: configured`, and `automationWorker: disabled`.
- Both disposable app processes were stopped cleanly with `SIGINT` after validation.

### Limits and retained disposable artifacts

- The seed contained synthetic records only and was inserted directly to exercise restore lineage; this drill did not repeat the browser login/RBAC suite. Authentication, tenant-role mutation denial, and automation behavior remain separate release-suite gates.
- The dump is a local, container-internal recovery artifact, not an encrypted off-host backup or a test of external backup retention.
- The two databases, dump, and host health-response file `/tmp/axoboard_restore_health_response_20260817.json` were intentionally retained for release review. No cleanup was executed.

After explicit cleanup approval, remove only these exact artifacts (never use a wildcard):

```bash
docker exec axoboard-release-pg-20260817 dropdb -U postgres \
  axoboard_restore_source_final_20260817
docker exec axoboard-release-pg-20260817 dropdb -U postgres \
  axoboard_restore_target_final_20260817
docker exec axoboard-release-pg-20260817 rm \
  /tmp/axoboard_restore_final_20260817.dump
rm /tmp/axoboard_restore_health_response_20260817.json
```
