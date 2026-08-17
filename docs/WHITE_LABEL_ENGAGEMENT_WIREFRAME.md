# White-label engagement and display wireframe

Status: interaction wireframe only. No production workers, device commands, audio delivery, or scoring writes are implemented in this phase.

## Product boundary

- AxoBoard remains visible in the authenticated editor/admin shell for billing, support, permissions, and auditability.
- Customer-facing dashboards, shared views, TV displays, celebrations, and competitions use only the workspace brand package.
- Provider lineage remains visible where required for trust; white-labeling does not hide the origin of a metric from authorized editors.
- Every customer-facing surface must have accessible fallbacks for missing logos, unsafe colors, reduced motion, muted audio, stale data, and unsupported viewport sizes.

## Shared runtime contract

```text
Certified metric snapshot
        │
        ├── scalar / series / category / event shape
        ├── timezone + business calendar
        ├── freshness + quality + lineage
        └── workspace brand package
                 │
                 ├── Goal intelligence → Gauge / Goal Pace
                 ├── Display runtime → TV / mobile / cached fallback
                 └── Event ledger → Celebration → Competition scoring
```

## 1. Certified metric and goal intelligence

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Revenue to goal                                   ✓ Certified · Fresh 2m │
│ $82,400                     82%                    [Trust details]        │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━○━━━━━━━━━━━━━━━━━━━━ $100K       │
│ Projected $108,200 · +8% ahead · $1,173/day required                    │
│ Milestones: 25 ✓  50 ✓  75 ✓  90 ○  100 ○                              │
└──────────────────────────────────────────────────────────────────────────┘

Trust drawer
┌────────────────────────────┬─────────────────────────────────────────────┐
│ STATUS                     │ DEFINITION                                  │
│ Healthy                    │ Net recognized sales                        │
│ Last verified 2m ago       │ Currency · America/Denver                   │
│ Stale after 15m            │ Business days Mon–Fri                       │
├────────────────────────────┼─────────────────────────────────────────────┤
│ LINEAGE                    │ FALLBACK                                    │
│ Google Sheets              │ Keep last-good value up to 6 hours          │
│ Revenue!D8                 │ Then hide from public displays               │
└────────────────────────────┴─────────────────────────────────────────────┘
```

Builder requirements:

- Goal can be a fixed value or another certified metric.
- Gauge needs minimum, target, optional stretch target, and direction (`higher is better` or `lower is better`).
- Projection uses workspace timezone and a selectable calendar: calendar days, weekdays, or custom working days.
- Milestones can emit previewable events but cannot publish until the metric is certified.

## 2. White-label display runtime

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ TV & Displays                         [Preview branded output] [Pair TV] │
├─────────────────────────────┬────────────────────────────────────────────┤
│ Sales floor TV              │ Runtime health                             │
│ ● Online · 18s heartbeat    │ Browser       Chrome 136 ✓                 │
│ 3840×2160 · 16:9            │ Viewport      4K / 16:9 ✓                  │
│ Branded as Northstar Sales  │ Data          Fresh ✓                      │
│ [Manage runtime]            │ Cache         Last-good ready ✓            │
├─────────────────────────────┼────────────────────────────────────────────┤
│ Loop: Morning pulse         │ Recovery policy                            │
│ Dashboard 45s               │ 1. Retry with backoff                      │
│ Competition 20s             │ 2. Render cached dashboard                 │
│ Celebration interrupt       │ 3. Show branded offline state              │
└─────────────────────────────┴────────────────────────────────────────────┘
```

Compatibility profiles:

- Responsive browser: mobile, tablet, laptop.
- Fixed stage: 720p, 1080p, ultrawide-safe 16:9 crop, and 4K.
- Reduced motion: crossfade instead of motion scenes.
- Muted/silent: caption and visual pulse replace audio.
- Weak network: cached last-good dashboard plus visible freshness state.

## 3. Celebration event ledger

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Celebration HQ                       [Moments] [Event ledger] [Rules]    │
├──────────────┬───────────────────────┬──────────────┬──────────┬─────────┤
│ 10:42:18     │ deal.won             │ Delivered    │ TV + Web │ Replay  │
│ evt_8F3…     │ Maya · $18,420       │ 2 targets    │ Branded  │ [▶]     │
├──────────────┼───────────────────────┼──────────────┼──────────┼─────────┤
│ 10:42:17     │ deal.won             │ Deduplicated │ —        │ Inspect │
│ evt_8F3…     │ Same source event    │ Safe         │          │ [→]     │
├──────────────┼───────────────────────┼──────────────┼──────────┼─────────┤
│ 10:31:04     │ goal.milestone.90    │ Quiet hours  │ Web only │ Release │
└──────────────┴───────────────────────┴──────────────┴──────────┴─────────┘
```

Every ledger entry shows event identity, workspace, source, rule version, dedupe result, destinations, brand version, delivery status, and replay lineage. Replays create a new delivery attempt referencing the immutable source event; they never mutate or recount the original event.

## 4. Generic team competition engine

```text
┌───────────────┬──────────────────────────────────┬────────────────────────┐
│ 1 Identity ✓  │ LIVE CUSTOMER PREVIEW            │ DATA & SCORING         │
│ 2 Data active │                                  │ Metric: Net sales      │
│ 3 Brand       │      NORTHSTAR SPRINT             │ Group by: Team         │
│ 4 Test        │   Comets 72  ━━━  85 Meteors     │ Rule: $500 = 15 pts    │
│ 5 Publish     │                                  │ Calendar: Mon–Fri      │
│               │      First to 100 wins            │ TZ: America/Denver     │
│               │                                  │ [Test event]           │
├───────────────┴──────────────────────────────────┴────────────────────────┤
│ Snapshot preview: evt_8F3 → +45 points → score 72 → 117 → winner Comets │
│ [Compare before/after] [Reset test] [Publish version 4]                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Engine requirements:

- Scoring is driven by certified metrics or normalized events, never provider-specific fields.
- Rule evaluation is deterministic and idempotent by `workspace + competition + source_event + rule_version`.
- Team membership, terms, scoring formulas, calendars, targets, tie-breakers, assets, sounds, and winner copy are workspace configuration.
- Test mode writes no live score and shows the exact before/after calculation.
- Published versions are immutable, schedulable, replayable, and rollback-safe.

## 5. Brand coverage and compatibility check

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Brand Studio                                      Draft v7 · Not live   │
├────────────────────────────┬─────────────────────────────────────────────┤
│ Workspace identity         │ CUSTOMER-FACING COVERAGE                    │
│ Logo / wordmark / colors   │ ✓ Dashboard   ✓ Shared view   ✓ TV         │
│ Terms / typography         │ ✓ Celebration ✓ Competition   ✓ Offline    │
│ Motion / sound policy      │                                             │
│                            │ COMPATIBILITY                               │
│ [Edit tokens]              │ ✓ Contrast  ✓ Reduced motion  ✓ Silent     │
│                            │ ✓ 720p  ✓ 1080p  ✓ 4K  ✓ Mobile            │
├────────────────────────────┴─────────────────────────────────────────────┤
│ [Preview all surfaces]                      [Publish customer brand v7] │
└──────────────────────────────────────────────────────────────────────────┘
```

## Motion plan

- Controls: 150ms press and focus feedback.
- Drawer/modal entry: 250ms fade + 12px rise.
- TV loop transitions: 300ms crossfade; no spatial motion in reduced-motion mode.
- Celebration preview: 400ms maximum for the intro; always skippable and captioned.
- Competition score preview: 300ms count-up; instant value replacement in reduced-motion mode.

## Wireframe acceptance

- The five requested capabilities share one metric/event/brand model.
- No Murphy names, formulas, logos, paths, or provider credentials exist in defaults.
- Every customer-facing preview uses workspace identity, not AxoBoard identity.
- Editor/admin chrome preserves AxoBoard identity and governance context.
- All new controls are keyboard reachable and at least 44px on mobile.
- Desktop 1440×1000 and mobile 390×844 have zero document-level overflow.
- Wide ledgers and rule previews use contained horizontal scrolling on small screens.
