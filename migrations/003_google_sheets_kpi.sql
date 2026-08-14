CREATE TABLE IF NOT EXISTS oauth_transactions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_sheets')),
  state_digest TEXT NOT NULL UNIQUE CHECK (length(state_digest) = 64),
  pkce_ciphertext BYTEA NOT NULL,
  pkce_iv BYTEA NOT NULL,
  pkce_auth_tag BYTEA NOT NULL,
  return_path TEXT NOT NULL DEFAULT '/app',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_sheets')),
  external_account_id TEXT NOT NULL,
  external_account_email TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy','degraded','reauthorization_required','disconnected')),
  token_ciphertext BYTEA NOT NULL,
  token_iv BYTEA NOT NULL,
  token_auth_tag BYTEA NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  access_token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error_code TEXT,
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_account_id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS kpi_mappings (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_sheets')),
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_title TEXT NOT NULL,
  sheet_id BIGINT NOT NULL,
  sheet_title TEXT NOT NULL,
  a1_range TEXT NOT NULL,
  aggregation TEXT NOT NULL CHECK (aggregation IN ('single_value','sum','average','count','min','max','latest_non_empty')),
  display_format TEXT NOT NULL DEFAULT 'number' CHECK (display_format IN ('number','currency','percentage')),
  refresh_seconds INTEGER NOT NULL DEFAULT 300 CHECK (refresh_seconds BETWEEN 60 AND 86400),
  stale_after_seconds INTEGER NOT NULL DEFAULT 900 CHECK (stale_after_seconds BETWEEN 120 AND 604800),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','degraded','deleted')),
  last_sync_at TIMESTAMPTZ,
  next_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mapping_id UUID NOT NULL,
  value NUMERIC NOT NULL,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  source_range TEXT NOT NULL,
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64),
  source_timestamp TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, mapping_id) REFERENCES kpi_mappings(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mapping_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  provider_status INTEGER,
  provider_request_id TEXT,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (workspace_id, mapping_id) REFERENCES kpi_mappings(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oauth_transactions_expiry_idx ON oauth_transactions(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS integration_connections_workspace_idx ON integration_connections(workspace_id, status);
CREATE INDEX IF NOT EXISTS kpi_mappings_workspace_idx ON kpi_mappings(workspace_id, status);
CREATE INDEX IF NOT EXISTS kpi_mappings_due_idx ON kpi_mappings(next_sync_at) WHERE status IN ('active','degraded');
CREATE INDEX IF NOT EXISTS metric_snapshots_mapping_idx ON metric_snapshots(workspace_id, mapping_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS integration_sync_runs_mapping_idx ON integration_sync_runs(workspace_id, mapping_id, started_at DESC);
