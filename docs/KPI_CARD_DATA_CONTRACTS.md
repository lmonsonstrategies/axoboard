# KPI card data contracts

Every Google Sheets card stores a bounded, display-ready snapshot. Dashboard rendering must not call Google again.

| Card | Required selection | Headers retained | Snapshot data |
| --- | --- | --- | --- |
| Scorecard | One numeric cell; one header/value pair; or three ordered fields (`rep`, `metric`, `goal`) | Value/comparison headers, or labels for rep/metric/goal | Scalar value, optional comparison, or a live rep-metric-goal payload |
| Goal pace | Scorecard shape plus optional goal | Value and comparison headers | Scalar value, goal, optional comparison |
| Gauge | Scorecard shape plus optional maximum goal | Value and comparison headers | Scalar value, maximum, optional comparison |
| Rep cards | Two columns (`label`, `value`) with a header row, or two horizontal value rows; optional shared or per-rep goal range | Label/value headers and orientation | Ordered labels, values, optional aligned goals and comparisons |
| Leaderboard | Rep-card shape | Label/value headers and orientation | Labels and values; ranking occurs only when rendered |
| Trend | Rep-card shape | Axis/series headers and orientation | Ordered labels, values, optional aligned comparison series |
| Category bar | Rep-card shape | Category/value headers and orientation | Ordered categories and values |
| Funnel | Rep-card shape | Stage/value headers and orientation | Ordered stages and values |
| Pipeline | Rep-card shape | Stage/value headers and orientation | Ordered stages and values |
| Activity feed | 2–4 columns with a header row | Every selected column header | Timestamp, event, optional detail and value |
| Heatmap | Header row, label column, numeric matrix | Corner label plus both axes | X/Y labels, numeric cells, minimum and maximum |
| Table | Any bounded grid | Selected header row, or spreadsheet column letters | Up to 200 rows and 40 columns |

## Guardrails

- Structured ranges are limited to 200 rows and 40 columns.
- Up to 12 non-adjacent ranges may be selected from one sheet. Equal-height ranges combine as logical columns; equal-width ranges combine as logical rows. Other shapes fail explicitly.
- Each range may be assigned a `header`, `metric`, or `goal` role. Header ranges must combine into one row whose width matches the metric data; AxoBoard prepends that row before building the card payload. Goal ranges are kept separate from metric aggregation.
- A goal may be one prepared numeric cell shared by the KPI, or a range containing exactly one prepared numeric goal per paired item. Mismatched goal shapes fail before save.
- A rep scorecard uses three fields in selection order: rep name, prepared metric, and prepared goal. The fields can be non-adjacent and refresh together through one Google batch request.
- Paired comparisons must supply exactly one value per primary label; labeled comparisons must keep the same labels and order.
- Scalar cards accept exactly one prepared numeric value. Formulas and totals belong in Google Sheets.
- Blank or non-numeric required values fail validation instead of silently changing the card.
- Spreadsheet metadata is cached briefly per authenticated connection and spreadsheet; metric values are never served from that cache.
- `display_payload` is the dashboard contract. It must contain every header, axis, label, value, goal, and comparison required to render without another provider request.
- The KPI builder preview uses the same card renderer and snapshot contract as the saved dashboard, so the review state is the actual output rather than an approximation.
- Editing a KPI revalidates the complete mapping, updates the workspace-owned configuration, and writes a new immutable snapshot. Historical snapshots are not rewritten.
