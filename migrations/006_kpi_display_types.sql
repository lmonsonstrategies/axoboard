ALTER TABLE kpi_mappings
  ADD COLUMN IF NOT EXISTS display_type TEXT NOT NULL DEFAULT 'scorecard',
  ADD COLUMN IF NOT EXISTS period_granularity TEXT;

ALTER TABLE kpi_mappings
  DROP CONSTRAINT IF EXISTS kpi_mappings_display_type_check,
  ADD CONSTRAINT kpi_mappings_display_type_check
    CHECK (display_type IN ('scorecard', 'rep_cards', 'leaderboard', 'table'));

ALTER TABLE kpi_mappings
  DROP CONSTRAINT IF EXISTS kpi_mappings_period_granularity_check,
  ADD CONSTRAINT kpi_mappings_period_granularity_check
    CHECK (period_granularity IS NULL OR period_granularity IN ('day', 'week', 'month', 'year'));

ALTER TABLE metric_snapshots
  ADD COLUMN IF NOT EXISTS display_payload JSONB;
