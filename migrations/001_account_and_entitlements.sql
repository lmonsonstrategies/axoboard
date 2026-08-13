CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Denver',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  token_digest TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','past_due','canceled')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_status_events (
  id BIGSERIAL PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  previous_status TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_payment','active','past_due','canceled')),
  source TEXT NOT NULL DEFAULT 'database',
  actor TEXT NOT NULL DEFAULT CURRENT_USER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status);
CREATE INDEX IF NOT EXISTS subscription_status_events_workspace_id_idx ON subscription_status_events(workspace_id, created_at DESC);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE sessions s SET workspace_id = selected.workspace_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, workspace_id
  FROM memberships
  ORDER BY user_id, created_at ASC
) selected
WHERE s.workspace_id IS NULL AND selected.user_id = s.user_id;
DELETE FROM sessions WHERE workspace_id IS NULL;
ALTER TABLE sessions ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_workspace_id_idx ON sessions(workspace_id);

INSERT INTO subscriptions (id, workspace_id, status)
SELECT md5('axoboard-subscription:' || w.id::text)::uuid, w.id, 'pending_payment'
FROM workspaces w
ON CONFLICT (workspace_id) DO NOTHING;

CREATE OR REPLACE FUNCTION audit_subscription_status_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO subscription_status_events (subscription_id, workspace_id, previous_status, status, source, actor)
    VALUES (NEW.id, NEW.workspace_id, NULL, NEW.status, COALESCE(NULLIF(current_setting('axoboard.audit_source', true), ''), 'database'), COALESCE(NULLIF(current_setting('axoboard.audit_actor', true), ''), CURRENT_USER));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO subscription_status_events (subscription_id, workspace_id, previous_status, status, source, actor)
    VALUES (NEW.id, NEW.workspace_id, OLD.status, NEW.status, COALESCE(NULLIF(current_setting('axoboard.audit_source', true), ''), 'database'), COALESCE(NULLIF(current_setting('axoboard.audit_actor', true), ''), CURRENT_USER));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscription_status_audit ON subscriptions;
CREATE TRIGGER subscription_status_audit
  AFTER INSERT OR UPDATE OF status ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION audit_subscription_status_change();

INSERT INTO subscription_status_events (subscription_id, workspace_id, previous_status, status, source, actor)
SELECT s.id, s.workspace_id, NULL, s.status, 'migration', CURRENT_USER
FROM subscriptions s
WHERE NOT EXISTS (SELECT 1 FROM subscription_status_events e WHERE e.subscription_id = s.id);
