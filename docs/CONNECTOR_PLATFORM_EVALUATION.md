# Connector Platform Evaluation

Updated: 2026-08-12

## Historical recommendation (superseded)

This evaluation originally selected Nango for a bounded spike. On 2026-08-12, Leroy chose direct provider OAuth for all AxoBoard integrations to avoid connector-platform fees. The candidate analysis remains for historical context; the active plan is `DIRECT_OAUTH_IMPLEMENTATION_PLAN.md`.

Nango is the closest match because it explicitly handles embedded customer authorization, credential storage/refresh, connection IDs, multi-tenant isolation, retries, rate limits, and observability. It publishes Google Sheets and HubSpot integration templates plus a working [Google Sheets customer-OAuth example](https://github.com/NangoHQ/google-sheets-api-integration). Its Elastic license and cloud/self-host feature boundaries require commercial review before commitment.

## Candidate matrix

| Candidate | Best use | Google Sheets + HubSpot | Multi-customer OAuth | Commercial fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Nango](https://github.com/NangoHQ/nango) | Embedded auth, proxy, syncs/actions | Yes, templates for both | Native connection model | Elastic license; cloud/enterprise options | **Selected** |
| [dlt](https://github.com/dlt-hub/dlt) | Python ingestion and normalization | Verified sources exist | Build credential broker yourself | Apache-2.0 core; platform is commercial | Useful behind broker, not as broker |
| [Meltano](https://github.com/meltano/meltano) + Singer taps | Batch ELT and connector SDK | Community taps for both | Build auth/tenant control plane | Core is open; tap quality varies | Good future ingestion fallback |
| [Airbyte](https://github.com/airbytehq/airbyte) | Large-scale ELT/catalog | Mature connectors | Embedded offering or substantial control plane | ELv2 restricts offering as managed service | Do not adopt without license agreement |
| [Activepieces](https://github.com/activepieces/activepieces) | Customer automation builder | Pieces for both | Enterprise embed supports tenant provisioning | MIT community core; embedding/multi-tenancy are commercial | Revisit only for customer-built automations |
| [n8n](https://github.com/n8n-io/n8n) | Internal workflow orchestration | Nodes for both | Customer credentials require commercial terms | Sustainable Use / paid Embed or suitable paid plan | Keep internal; not KPI connector core |

## Target architecture

```text
Customer browser
  -> AxoBoard integration UI
  -> AxoBoard OAuth session service (tenant, state, PKCE, return path)
  -> ConnectorAdapter
       -> NangoAuthAdapter (recommended spike)
       -> DirectProviderAdapter (escape hatch)
  -> Google Sheets / HubSpot / future provider

Sync worker
  -> connector records/actions
  -> provider-specific extractor
  -> normalized metric observations
  -> KPI calculator + snapshot store
  -> dashboard cache / alerts / celebrations / Kombat scoring
```

The browser receives only an opaque `connection_id`. AxoBoard maps it to `tenant_id + provider + external_account_id + credential_reference`. Nango's connection ID must never be accepted directly from an untrusted request without that tenant ownership check.

## Connector contracts

```ts
interface ConnectorAdapter {
  startAuthorization(input: StartAuthorization): Promise<AuthorizationHandoff>;
  completeAuthorization(input: OAuthCallback): Promise<ConnectionRef>;
  listResources(connection: ConnectionRef): Promise<SourceResource[]>;
  discoverFields(resource: SourceResource): Promise<SourceField[]>;
  previewMetric(definition: MetricDefinition): Promise<MetricPreview>;
  sync(definition: MetricDefinition, cursor?: string): Promise<SyncResult>;
  health(connection: ConnectionRef): Promise<ConnectionHealth>;
  disconnect(connection: ConnectionRef): Promise<void>;
}
```

Provider adapters output observations, not dashboard cards:

```json
{
  "tenant_id": "tenant_opaque",
  "connection_id": "conn_opaque",
  "mapping_id": "map_opaque",
  "event_id": "provider-version-or-content-hash",
  "observed_at": "2026-08-12T12:00:00Z",
  "source_timestamp": "2026-08-12T11:59:31Z",
  "value": 55396,
  "dimensions": { "currency": "USD" },
  "lineage": { "provider": "google_sheets", "resource": "opaque", "selector": "Summary!D8" }
}
```

## Fastest MVP path

1. Register separate AxoBoard development OAuth apps for Google and HubSpot with localhost and beta callbacks.
2. Run a two-week Nango Cloud development spike using only fresh test accounts and synthetic/non-production data.
3. Implement `NangoAuthAdapter`, tenant ownership checks, connection health, and disconnect/revoke.
4. Build Google file -> worksheet -> A1 range discovery and HubSpot object -> property -> filter discovery.
5. Normalize both into the same `MetricObservation` and render one KPI from each.
6. Run isolation tests with two customer tenants before adding another provider.
7. Review Nango license, pricing, data-processing terms, exportability, and self-host/cloud exit path before production commitment.

## Top failure modes and detection

1. **Cross-tenant connection mix-up** — deny any connection whose stored tenant does not equal the authenticated tenant; integration test with deliberately swapped IDs.
2. **Stale or revoked OAuth grant** — health state turns degraded, refresh stops, KPI shows last-known-good timestamp, and admin receives a reconnect action.
3. **Connector/vendor lock-in** — contract tests run against Nango and a direct mock adapter; raw provider identifiers and tokens never leak into KPI/card schemas.

## Cost implications

- Nango Cloud reduces initial auth/sync engineering and operations but introduces per-connection/usage cost and vendor dependency.
- Self-hosting reduces direct platform fees but adds PostgreSQL, Redis/queues, workers, upgrades, monitoring, on-call, and security/compliance burden.
- dlt/Meltano/Airbyte add value when data volume and history become warehouse-shaped; they are excess machinery for the first cell/property KPI.
- Activepieces/n8n are economically justified only if AxoBoard later sells a customer-facing automation builder, not merely data connections.
