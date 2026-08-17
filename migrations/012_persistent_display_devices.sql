CREATE TABLE IF NOT EXISTS display_devices (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  pairing_code_digest TEXT,
  pairing_expires_at TIMESTAMPTZ,
  token_digest TEXT,
  content_mode TEXT NOT NULL DEFAULT 'full_dashboard' CHECK (content_mode IN ('full_dashboard','selected_kpis')),
  kpi_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  rotation_seconds INTEGER NOT NULL DEFAULT 15 CHECK (rotation_seconds BETWEEN 5 AND 300),
  paired_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_user_agent TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (workspace_id, id),
  UNIQUE (pairing_code_digest),
  UNIQUE (token_digest)
);

CREATE INDEX IF NOT EXISTS display_devices_workspace_status_idx
  ON display_devices(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS display_devices_pairing_expiry_idx
  ON display_devices(pairing_expires_at) WHERE status = 'pending';
