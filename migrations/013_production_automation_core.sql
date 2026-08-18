CREATE TABLE IF NOT EXISTS automation_destinations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  action_type TEXT NOT NULL CHECK (action_type IN ('internal_tv_celebration')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','disabled')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_ref_ciphertext BYTEA,
  credential_ref_iv BYTEA,
  credential_ref_auth_tag BYTEA,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id),
  CHECK (jsonb_typeof(config) = 'object'),
  CHECK (
    (credential_ref_ciphertext IS NULL AND credential_ref_iv IS NULL AND credential_ref_auth_tag IS NULL)
    OR
    (credential_ref_ciphertext IS NOT NULL AND credential_ref_iv IS NOT NULL AND credential_ref_auth_tag IS NOT NULL)
  )
);

ALTER TABLE metric_snapshots
  ADD CONSTRAINT metric_snapshots_workspace_id_unique UNIQUE (workspace_id, id);

CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','degraded','archived')),
  draft_version_id UUID,
  published_version_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  FOREIGN KEY (workspace_id, metric_id) REFERENCES metric_definitions(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS automation_rule_versions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','published','retired')),
  trigger_config JSONB NOT NULL,
  guardrail_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metric_contract_fingerprint TEXT,
  activation_cursor_at TIMESTAMPTZ,
  activation_cursor_event_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  FOREIGN KEY (workspace_id, rule_id) REFERENCES automation_rules(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, activation_cursor_event_id) REFERENCES domain_events(workspace_id, id) ON DELETE SET NULL (activation_cursor_event_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, rule_id, version),
  CHECK (jsonb_typeof(trigger_config) = 'object'),
  CHECK (jsonb_typeof(guardrail_config) = 'object'),
  CHECK (metric_contract_fingerprint IS NULL OR length(metric_contract_fingerprint) = 64),
  CHECK (
    (lifecycle = 'draft' AND published_at IS NULL)
    OR
    (lifecycle IN ('published','retired') AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS automation_rule_versions_one_draft_idx
  ON automation_rule_versions(workspace_id, rule_id) WHERE lifecycle = 'draft';

ALTER TABLE automation_rules
  ADD CONSTRAINT automation_rules_draft_version_fk
  FOREIGN KEY (workspace_id, draft_version_id) REFERENCES automation_rule_versions(workspace_id, id) ON DELETE SET NULL (draft_version_id);

ALTER TABLE automation_rules
  ADD CONSTRAINT automation_rules_published_version_fk
  FOREIGN KEY (workspace_id, published_version_id) REFERENCES automation_rule_versions(workspace_id, id) ON DELETE SET NULL (published_version_id);

CREATE TABLE IF NOT EXISTS automation_actions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_version_id UUID NOT NULL,
  destination_id UUID,
  position INTEGER NOT NULL DEFAULT 1 CHECK (position BETWEEN 1 AND 50),
  action_type TEXT NOT NULL CHECK (action_type IN ('internal_tv_celebration')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, rule_version_id) REFERENCES automation_rule_versions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, destination_id) REFERENCES automation_destinations(workspace_id, id) ON DELETE SET NULL (destination_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, rule_version_id, position),
  CHECK (jsonb_typeof(config) = 'object')
);

CREATE TABLE IF NOT EXISTS automation_rule_state (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  last_event_id UUID,
  last_event_at TIMESTAMPTZ,
  last_value NUMERIC,
  last_goal_percent NUMERIC,
  condition_started_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  daily_run_date DATE,
  daily_run_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_run_count >= 0),
  suppressed_count BIGINT NOT NULL DEFAULT 0 CHECK (suppressed_count >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_result TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, rule_id),
  FOREIGN KEY (workspace_id, rule_id) REFERENCES automation_rules(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, last_event_id) REFERENCES domain_events(workspace_id, id) ON DELETE SET NULL (last_event_id)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  rule_version_id UUID NOT NULL,
  metric_id UUID NOT NULL,
  source_event_id UUID,
  source_snapshot_id UUID,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','suppressed','dead_letter','canceled')),
  trigger_value NUMERIC,
  previous_value NUMERIC,
  reason_code TEXT,
  evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, rule_id) REFERENCES automation_rules(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, rule_version_id) REFERENCES automation_rule_versions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, metric_id) REFERENCES metric_definitions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_event_id) REFERENCES domain_events(workspace_id, id) ON DELETE SET NULL (source_event_id),
  FOREIGN KEY (workspace_id, source_snapshot_id) REFERENCES metric_snapshots(workspace_id, id) ON DELETE SET NULL (source_snapshot_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  CHECK (jsonb_typeof(evaluation) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_rule_event_idx
  ON automation_runs(workspace_id, rule_version_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_rule_snapshot_idx
  ON automation_runs(workspace_id, rule_version_id, source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS automation_action_attempts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  action_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','dead_letter','canceled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  response_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, run_id) REFERENCES automation_runs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, action_id) REFERENCES automation_actions(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, run_id, action_id),
  UNIQUE (workspace_id, idempotency_key),
  CHECK (jsonb_typeof(response_metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE event_outbox DROP CONSTRAINT IF EXISTS event_outbox_status_check;
ALTER TABLE event_outbox
  ADD CONSTRAINT event_outbox_status_check CHECK (status IN ('pending','processing','processed','failed','dead_letter'));
ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION protect_published_automation_version() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.lifecycle <> 'draft'
    AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'published automation versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.lifecycle <> 'draft' AND (
    NEW.rule_id IS DISTINCT FROM OLD.rule_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.trigger_config IS DISTINCT FROM OLD.trigger_config
    OR NEW.guardrail_config IS DISTINCT FROM OLD.guardrail_config
    OR NEW.metric_contract_fingerprint IS DISTINCT FROM OLD.metric_contract_fingerprint
    OR NEW.activation_cursor_at IS DISTINCT FROM OLD.activation_cursor_at
    OR NEW.activation_cursor_event_id IS DISTINCT FROM OLD.activation_cursor_event_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.published_by IS DISTINCT FROM OLD.published_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'published automation versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (OLD.lifecycle = 'published' AND NEW.lifecycle NOT IN ('published','retired'))
    OR (OLD.lifecycle = 'retired' AND NEW.lifecycle <> 'retired')
  ) THEN
    RAISE EXCEPTION 'published automation lifecycle cannot be reversed' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS automation_rule_version_immutability ON automation_rule_versions;
CREATE TRIGGER automation_rule_version_immutability
  BEFORE UPDATE OR DELETE ON automation_rule_versions
  FOR EACH ROW EXECUTE FUNCTION protect_published_automation_version();

CREATE OR REPLACE FUNCTION protect_published_automation_action() RETURNS TRIGGER AS $$
DECLARE old_version_lifecycle TEXT;
DECLARE new_version_lifecycle TEXT;
DECLARE target_workspace_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_workspace_id := NEW.workspace_id;
    SELECT lifecycle INTO new_version_lifecycle
    FROM automation_rule_versions
    WHERE workspace_id = NEW.workspace_id AND id = NEW.rule_version_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_workspace_id := OLD.workspace_id;
    SELECT lifecycle INTO old_version_lifecycle
    FROM automation_rule_versions
    WHERE workspace_id = OLD.workspace_id AND id = OLD.rule_version_id;
  ELSE
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'automation actions cannot move between workspaces' USING ERRCODE = '55000';
    END IF;
    target_workspace_id := OLD.workspace_id;
    SELECT lifecycle INTO old_version_lifecycle
    FROM automation_rule_versions
    WHERE workspace_id = OLD.workspace_id AND id = OLD.rule_version_id;
    SELECT lifecycle INTO new_version_lifecycle
    FROM automation_rule_versions
    WHERE workspace_id = NEW.workspace_id AND id = NEW.rule_version_id;
  END IF;
  IF (COALESCE(old_version_lifecycle, 'draft') <> 'draft' OR COALESCE(new_version_lifecycle, 'draft') <> 'draft')
    AND EXISTS (SELECT 1 FROM workspaces WHERE id = target_workspace_id) THEN
    RAISE EXCEPTION 'published automation actions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS automation_action_immutability ON automation_actions;
CREATE TRIGGER automation_action_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON automation_actions
  FOR EACH ROW EXECUTE FUNCTION protect_published_automation_action();

CREATE INDEX IF NOT EXISTS automation_rules_workspace_state_idx
  ON automation_rules(workspace_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS automation_rules_metric_idx
  ON automation_rules(workspace_id, metric_id, state);
CREATE INDEX IF NOT EXISTS automation_destinations_workspace_status_idx
  ON automation_destinations(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_workspace_time_idx
  ON automation_runs(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_rule_time_idx
  ON automation_runs(workspace_id, rule_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS automation_action_attempts_due_idx
  ON automation_action_attempts(available_at, lease_expires_at)
  WHERE status IN ('pending','failed','processing');
CREATE INDEX IF NOT EXISTS automation_action_attempts_health_idx
  ON automation_action_attempts(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_workspace_time_idx
  ON audit_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_outbox_automation_due_idx
  ON event_outbox(available_at, lease_expires_at)
  WHERE status IN ('pending','failed','processing');
