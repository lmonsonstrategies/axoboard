ALTER TABLE kpi_mappings
  DROP CONSTRAINT IF EXISTS kpi_mappings_display_type_check,
  ADD CONSTRAINT kpi_mappings_display_type_check
    CHECK (display_type IN (
      'scorecard',
      'goal_pace',
      'gauge',
      'rep_cards',
      'leaderboard',
      'trend',
      'category_bar',
      'funnel',
      'pipeline',
      'activity_feed',
      'heatmap',
      'table'
    ));
