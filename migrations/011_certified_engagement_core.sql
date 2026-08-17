ALTER TABLE kpi_mappings
  ADD COLUMN IF NOT EXISTS goal_direction TEXT NOT NULL DEFAULT 'higher_is_better',
  ADD COLUMN IF NOT EXISTS goal_calendar_type TEXT NOT NULL DEFAULT 'weekdays',
  ADD COLUMN IF NOT EXISTS goal_timezone TEXT NOT NULL DEFAULT 'America/Denver';

ALTER TABLE kpi_mappings
  ADD CONSTRAINT kpi_mappings_goal_direction_check CHECK (goal_direction IN ('higher_is_better','lower_is_better')),
  ADD CONSTRAINT kpi_mappings_goal_calendar_check CHECK (goal_calendar_type IN ('calendar_days','weekdays'));

CREATE TABLE IF NOT EXISTS metric_definitions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mapping_id UUID NOT NULL,
  semantic_key TEXT NOT NULL,
  name TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'number' CHECK (data_type IN ('number')),
  unit TEXT NOT NULL DEFAULT 'number' CHECK (unit IN ('number','currency','percentage')),
  direction TEXT NOT NULL DEFAULT 'higher_is_better' CHECK (direction IN ('higher_is_better','lower_is_better')),
  definition TEXT NOT NULL,
  certification_status TEXT NOT NULL DEFAULT 'certified' CHECK (certification_status IN ('draft','certified','suspended')),
  certification_method TEXT NOT NULL DEFAULT 'source_contract_v1',
  certified_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, mapping_id) REFERENCES kpi_mappings(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, mapping_id),
  UNIQUE (workspace_id, semantic_key)
);

ALTER TABLE metric_snapshots
  ADD COLUMN IF NOT EXISTS metric_id UUID;

ALTER TABLE metric_snapshots
  ADD CONSTRAINT metric_snapshots_metric_fk
  FOREIGN KEY (workspace_id, metric_id) REFERENCES metric_definitions(workspace_id, id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS goal_configs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  target_source TEXT NOT NULL CHECK (target_source IN ('manual','google_sheets')),
  target_value NUMERIC,
  direction TEXT NOT NULL DEFAULT 'higher_is_better' CHECK (direction IN ('higher_is_better','lower_is_better')),
  period_granularity TEXT NOT NULL DEFAULT 'month' CHECK (period_granularity IN ('day','week','month','year')),
  calendar_type TEXT NOT NULL DEFAULT 'weekdays' CHECK (calendar_type IN ('calendar_days','weekdays')),
  timezone TEXT NOT NULL DEFAULT 'America/Denver',
  milestones NUMERIC[] NOT NULL DEFAULT ARRAY[25,50,75,90,100]::NUMERIC[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  FOREIGN KEY (workspace_id, metric_id) REFERENCES metric_definitions(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, metric_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS goal_configs_one_active_metric_idx
  ON goal_configs(workspace_id, metric_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS goal_evaluations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL,
  metric_id UUID NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES metric_snapshots(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  actual_value NUMERIC NOT NULL,
  target_value NUMERIC NOT NULL,
  attainment NUMERIC NOT NULL,
  projected_finish NUMERIC,
  required_per_day NUMERIC,
  completed_days INTEGER NOT NULL,
  remaining_days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ahead','on_track','behind','complete','unavailable')),
  next_milestone NUMERIC,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, goal_id) REFERENCES goal_configs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, metric_id) REFERENCES metric_definitions(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, goal_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  metric_id UUID,
  goal_id UUID,
  source_snapshot_id UUID REFERENCES metric_snapshots(id) ON DELETE SET NULL,
  rule_version INTEGER NOT NULL DEFAULT 1,
  brand_version INTEGER NOT NULL DEFAULT 1,
  period_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replay_of_event_id UUID REFERENCES domain_events(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, metric_id) REFERENCES metric_definitions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, goal_id) REFERENCES goal_configs(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE IF NOT EXISTS event_outbox (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, event_id) REFERENCES domain_events(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, event_id)
);

CREATE TABLE IF NOT EXISTS brand_packages (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','retired')),
  name TEXT NOT NULL,
  tokens JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, version),
  CHECK (jsonb_typeof(tokens) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_packages_one_published_idx
  ON brand_packages(workspace_id) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS metric_definitions_workspace_status_idx ON metric_definitions(workspace_id, certification_status);
CREATE INDEX IF NOT EXISTS goal_evaluations_metric_idx ON goal_evaluations(workspace_id, metric_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS domain_events_workspace_time_idx ON domain_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_outbox_due_idx ON event_outbox(available_at) WHERE status IN ('pending','failed');
