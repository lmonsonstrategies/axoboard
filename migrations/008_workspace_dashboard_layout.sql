CREATE TABLE IF NOT EXISTS workspace_dashboard_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  layout JSONB NOT NULL DEFAULT '{"preset":"balanced","showTrend":true,"showActionCenter":true,"kpiOrder":[]}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_dashboard_settings_updated_at_idx
  ON workspace_dashboard_settings(updated_at DESC);
