ALTER TABLE kpi_mappings
  ADD COLUMN IF NOT EXISTS goal_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE kpi_mappings
  DROP CONSTRAINT IF EXISTS kpi_mappings_goal_source_check,
  ADD CONSTRAINT kpi_mappings_goal_source_check
    CHECK (goal_source IN ('manual','google_sheets'));

ALTER TABLE metric_snapshots
  ADD COLUMN IF NOT EXISTS goal_value NUMERIC;
