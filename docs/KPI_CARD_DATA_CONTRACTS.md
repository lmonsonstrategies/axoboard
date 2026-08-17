# KPI card data contracts

Every Google Sheets card stores a bounded, display-ready snapshot. Dashboard rendering must not call Google again.

| Card | Required selection | Headers retained | Snapshot data |
| --- | --- | --- | --- |
| Scorecard | One numeric cell, or one header above one numeric cell | Value and comparison headers when selected | Scalar value, optional comparison |
| Goal pace | Scorecard shape plus optional goal | Value and comparison headers | Scalar value, goal, optional comparison |
| Gauge | Scorecard shape plus optional maximum goal | Value and comparison headers | Scalar value, maximum, optional comparison |
| Rep cards | Two columns (`label`, `value`) with a header row, or two horizontal value rows | Label/value headers and orientation | Ordered labels, values, optional aligned comparisons |
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
- Paired comparisons must supply exactly one value per primary label; labeled comparisons must keep the same labels and order.
- Scalar cards accept exactly one prepared numeric value. Formulas and totals belong in Google Sheets.
- Blank or non-numeric required values fail validation instead of silently changing the card.
- Spreadsheet metadata is cached briefly per authenticated connection and spreadsheet; metric values are never served from that cache.
- `display_payload` is the dashboard contract. It must contain every header, axis, label, value, and comparison required to render without another provider request.
