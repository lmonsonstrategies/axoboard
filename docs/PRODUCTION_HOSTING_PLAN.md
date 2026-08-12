# AxoBoard production hosting plan

Updated: 2026-08-12

## Recommended MVP architecture

Use a small dedicated production stack behind `axoboard.io`:

```text
app.axoboard.io  -> web application / customer UI
api.axoboard.io  -> authenticated API + Nango webhook receiver
                       |
                       +-> managed PostgreSQL
                       +-> managed object storage
                       +-> Nango Cloud
                       +-> background KPI sync worker
```

Start with one application service and one worker built from the same versioned image. Keep PostgreSQL managed rather than running it on the application VPS. Published dashboard payloads should be cached so TV viewers never call providers directly.

## Deployment requirements

- Separate development, staging, and production environments and keys.
- TLS-only public endpoints with automatic certificate renewal.
- Tenant-scoped database keys and connection ownership checks on every request.
- Encrypted secret storage; no secrets in Git, images, frontend bundles, or logs.
- Raw-body Nango webhook signature verification and replay protection.
- Idempotent workers with three exponential-backoff retries and a dead-letter state.
- Health endpoints for web, API, database, worker, and last successful provider sync.
- Daily database backups plus a tested restore procedure.
- Versioned deploys with one-command rollback.
- Per-tenant rate and usage metering from the first external pilot.

## Fastest MVP sequence

1. Choose the hosting vendor and region.
2. Provision staging first at `staging.axoboard.io` and `api-staging.axoboard.io`.
3. Deploy the tenant/auth/connection skeleton with an empty PostgreSQL database.
4. Configure the Nango staging webhook and verify signed delivery.
5. Register fresh AxoBoard-owned Google and HubSpot OAuth applications.
6. Complete one live KPI from each provider in two isolated test tenants.
7. Run mobile, tenant-isolation, revoke/reconnect, stale-data, backup/restore, and rollback tests.
8. Promote the same image to production and invite the first design partner.

## Top failure modes and detection

1. **Cross-tenant connection access:** automated negative tests swap tenant and connection IDs; expected result is `403` with zero provider calls.
2. **Webhook signature/body mismatch:** record verification outcome and request ID without payload secrets; alert on repeated `401` responses.
3. **Stale data shown as current:** every KPI carries fetched time, source time, freshness policy, and last-known-good state; stale values visibly block automations.

## Cost posture

For beta, target a small application service, managed PostgreSQL, object storage, email, monitoring, and Nango Cloud. Avoid Kubernetes and self-hosted connector infrastructure until customer volume or compliance requirements justify the operational burden.
