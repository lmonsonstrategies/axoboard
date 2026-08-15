ALTER TABLE kpi_mappings
  ADD COLUMN IF NOT EXISTS goal_value NUMERIC,
  ADD COLUMN IF NOT EXISTS comparison_sheet_id BIGINT,
  ADD COLUMN IF NOT EXISTS comparison_sheet_title TEXT,
  ADD COLUMN IF NOT EXISTS comparison_a1_range TEXT,
  ADD COLUMN IF NOT EXISTS comparison_aggregation TEXT,
  ADD COLUMN IF NOT EXISTS comparison_include_headers BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE metric_snapshots
  ADD COLUMN IF NOT EXISTS comparison_value NUMERIC,
  ADD COLUMN IF NOT EXISTS comparison_source_range TEXT,
  ADD COLUMN IF NOT EXISTS comparison_delta NUMERIC;

ALTER TABLE kpi_mappings
  ADD CONSTRAINT kpi_comparison_aggregation_check
  CHECK (comparison_aggregation IS NULL OR comparison_aggregation IN ('single_value','sum','average','count','min','max','latest_non_empty')),
  ADD CONSTRAINT kpi_comparison_source_check
  CHECK ((comparison_a1_range IS NULL AND comparison_sheet_id IS NULL AND comparison_aggregation IS NULL) OR (comparison_a1_range IS NOT NULL AND comparison_sheet_id IS NOT NULL AND comparison_aggregation IS NOT NULL));
