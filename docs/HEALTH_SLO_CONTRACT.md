# Health SLO receipt contract

`scripts/health-slo-receipt.mjs` is a dependency-free, read-only operations probe. It reads the public `/healthz` endpoint and writes exactly one compact JSON object to stdout. It does not replace `scripts/verify-production.mjs`; that release verifier remains authoritative and unchanged.

## Invocation and thresholds

```sh
BASE_URL=https://axoboard.io EXPECTED_SHA="$DEPLOY_SHA" node scripts/health-slo-receipt.mjs >> var/health-slo-receipts.jsonl
```

The probe removes the path, query string, fragment, and URL credentials before requesting or recording the origin. It sends no cookies or authorization data. `HEALTH_TIMEOUT_MS` defaults to 5000 ms and `HEALTH_LATENCY_SLO_MS` defaults to 2000 ms; both must be positive integer milliseconds. `EXPECTED_SHA` may be unset or exactly empty to disable release-identity comparison. Any supplied nonempty value must be exactly 40 hexadecimal characters; prefixes, surrounding whitespace, suffixes, and other lengths are invalid configuration. Valid uppercase input is normalized to lowercase, and the deployed SHA must equal the complete expected SHA.

Exit code `0` means all evaluated contract and SLO checks passed. Exit code `1` means a receipt was emitted but at least one check failed. Exit code `2` means configuration was invalid and no receipt could safely be emitted. The command is cron-safe: it is non-interactive, has a bounded request timeout, produces one JSONL record on stdout, and sends only configuration failures to stderr. The destination directory must already exist.

## Receipt and redaction

Fields have a stable order: UTC `timestamp`, `baseUrlOrigin`, `expectedSha`, `deployedSha`, `httpStatus`, integer `responseLatencyMs`, `databaseState`, sorted `integrationStates`, `workerState`, `passed`, and ordered `reasons`. Optional integrations in `not_configured` state do not fail the probe. Database `unhealthy`/`unknown` and worker `dependency_unavailable`/`degraded`/`stale`/`unknown` do fail it.

Receipts never contain query strings, URL credentials, cookies, request or response headers, account data, tenant identifiers, response bodies, or raw errors. Failure reasons come only from the probe's fixed vocabulary: `timeout`, `request_failed`, `malformed_json`, `latency_slo_exceeded`, `http_status_not_200`, `health_not_ok`, `deployed_sha_mismatch`, `database_unhealthy`, and `worker_unhealthy`.

## Storage and response

Retain JSONL receipts for 30 days with access limited to operators, then delete them using the log store's lifecycle policy. For retry deduplication, use the tuple `(timestamp, baseUrlOrigin, expectedSha)` as the record identity; do not hash or ingest any unredacted request material. Preserve separate records at different timestamps so latency history remains auditable.

On failure, first check the HTTP status and latency, then compare deployed and expected SHA, then inspect database state, worker state and its server-side logs, and finally the integration states. `request_failed` suggests DNS/TLS/routing checks; `timeout` suggests endpoint reachability or saturation; `malformed_json` suggests an unexpected proxy or application response. Use authenticated platform logs for deeper diagnosis rather than expanding this receipt with sensitive details.

Run the deterministic, network-free fixtures with:

```sh
node scripts/health-slo-receipt-test.mjs
```
