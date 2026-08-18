# Visual QA board

## Outcome

The Visual QA board is an authenticated, synthetic, read-only acceptance surface for every AxoBoard visualization. It renders 20 deterministic cards without creating a Google connection, KPI mapping, metric snapshot, dashboard setting, event, or automation.

- 12 canonical types: scorecard, goal pace, gauge, rep cards, leaderboard, trend, category bar, funnel, pipeline, activity feed, heatmap, and table.
- 8 isolated edge cases: flat, declining, negative, outlier, comparison, long label, stale, and empty.
- 5 render paths: saved dashboard, per-card builder preview, authenticated TV preview, paired TV, and both authenticated/paired celebration overlays.

The empty Activity Feed is intentional renderer fault injection. Production Google ingestion rejects empty selected ranges; the fixture exists only to certify the empty-state UI without fabricating a KPI in a customer workspace.

## Access boundary

Visual QA is off by default and returns `404` unless all three controls match:

```env
AXOBOARD_VISUAL_QA_ENABLED=true
AXOBOARD_VISUAL_QA_WORKSPACE_ID=5bcdfc3c-a7ef-4e56-bfc7-29a627775f32
AXOBOARD_VISUAL_QA_WORKSPACE_NAME=AxoBoard Production QA
```

The authenticated route additionally requires an `owner`, `admin`, or `editor` session in that exact workspace. Paired TV derives the workspace from its HttpOnly device token and applies the same ID/name allowlist. The board disables mutation, integration, display-management, billing, event, and automation capabilities.

For certification screenshots, freeze the server fixture clock and browser clock to the same ISO timestamp:

```env
AXOBOARD_VISUAL_QA_FROZEN_AT=2026-08-18T15:00:00.000Z
```

Leave the clock variable blank for ordinary exploratory QA. The default clock remains stable for the life of the server process, keeping authenticated and paired payloads identical.

## Surfaces

| Surface | URL or action |
| --- | --- |
| Saved dashboard | `/app?board=visual-qa` |
| Builder preview | Select any synthetic card, or use **Builder preview** in the QA banner |
| Authenticated TV | Use **TV preview** in the QA banner |
| Authenticated celebration | Use **Celebration** in the QA banner |
| Paired TV | `/tv?board=visual-qa` on a display paired to the allowlisted workspace |
| Paired celebration | `/tv?board=visual-qa&celebration=1` |

The normal `/app`, bootstrap, and `/api/display/runtime` paths are unchanged. Exiting the board returns to `/app#dashboard`.

## Acceptance contract

Run:

```bash
npm run test:visual-qa
```

The contract checks stable type/order, all eight edge cases, exact comparison series, signed values, the 999 heatmap outlier, numeric activity value `0`, stale/empty semantics, 12×6 table data, long-label length, exact tenant gating, disabled mutations, one brand-only database `SELECT`, zero provider calls, and paired-TV parity hooks.

Browser certification uses `390×844`, `1440×900`, and `1920×1080`, with `en-US`, `America/Denver`, reduced motion, loaded fonts, and two settled animation frames. A pass requires:

- no console errors or page-level horizontal overflow;
- raw label/value/goal/comparison parity across renderers;
- exactly two trend series for the comparison fixture;
- visible numeric `0` in Activity Feed;
- signed category values and bounded absolute-width bars;
- explicit stale/empty states, with no stale card labeled Live;
- accessible full text for truncated pipeline labels;
- `Showing N of M` whenever a TV collection is capped;
- internal table scrolling instead of page overflow;
- celebration copy and controls contained within the viewport.

Screenshots are evidence, not automatic golden failures, until a baseline is reviewed and approved.

## Rollback

Set `AXOBOARD_VISUAL_QA_ENABLED=false` or remove the three Visual QA environment variables. No fixture data needs deletion because the board never persists fixture records.

## Fast failure checks

1. **Board returns 404:** verify the enable flag plus exact workspace ID/name and the signed-in role.
2. **Paired TV returns 404:** verify the device is paired to the allowlisted workspace and includes `?board=visual-qa`.
3. **Screenshots disagree:** set the frozen clock on the server and browser, clear the dedicated Visual QA cache key, then re-run with locale/timezone fixed.
