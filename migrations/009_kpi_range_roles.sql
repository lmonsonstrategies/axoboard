ALTER TABLE kpi_mappings
  ADD COLUMN IF NOT EXISTS range_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE kpi_mappings
  DROP CONSTRAINT IF EXISTS kpi_mappings_range_roles_array_check,
  ADD CONSTRAINT kpi_mappings_range_roles_array_check
    CHECK (jsonb_typeof(range_roles) = 'array');
