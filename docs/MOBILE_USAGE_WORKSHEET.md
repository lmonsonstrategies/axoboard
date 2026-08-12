# AxoBoard mobile usage worksheet

Status: required release gate  
Owner: Product + Engineering  
Updated: 2026-08-12

## Non-negotiable policy

Every AxoBoard surface must support phone use before it can be called complete. Desktop-only behavior requires a documented exception, a safe mobile alternative, and Leroy's explicit approval.

This worksheet is completed for every material feature, route, modal, connector, visualization, or workflow change. A passing desktop test does not imply mobile acceptance.

## Mobile users and jobs

| User | Mobile context | Must be able to do |
| --- | --- | --- |
| Sales rep | Between calls or away from the floor | Check personal/team pace, understand a KPI, replay a win, hear assigned sounds, view competition state |
| Manager | Walking the floor or off-site | Scan exceptions, drill into source context, acknowledge an alert, share a snapshot, pause noisy automation |
| Admin | Setting up from a phone in a pinch | Connect sources, map a simple KPI, pair a screen, change a loop, publish/rollback a draft |
| Executive | Fast remote check | Open a secure link, read the executive view, understand freshness, receive scheduled snapshots |
| TV installer | Standing at a display | Pair with a short code, confirm content, inspect heartbeat, recover from a disconnected state |

## Baseline device matrix

| Class | Test viewport | Purpose | Required |
| --- | ---: | --- | --- |
| Small phone | 320×568 | Hard lower bound and localization stress | Yes |
| Standard phone | 390×844 | Primary iPhone-class acceptance | Yes |
| Large phone | 430×932 | Large iPhone/Android and dynamic type | Yes |
| Small tablet portrait | 768×1024 | Manager/admin workflows | Yes |
| Tablet landscape | 1024×768 | Editing and display setup | Yes |

Also test Chrome/Android and Safari/iOS before production launch. The prototype automation covers Chromium; iOS Safari remains a physical/device-cloud gate.

## Global acceptance worksheet

Complete each row with `Pass`, `Fail`, or `N/A`, plus a screenshot or test reference.

| Area | Acceptance rule | Status | Evidence / issue |
| --- | --- | --- | --- |
| Layout | No document-level horizontal scrolling at any required viewport | Pass at 390px | Automated DOM width audit, 2026-08-12 |
| Touch | Primary and repeated controls are at least 44×44 CSS pixels | Pass at 390px | Mobile CSS gate + touch-target audit |
| Navigation | All eight product surfaces are reachable one-handed; horizontal nav shows a clear scroll affordance | Pass | `mobile-dashboard.png` |
| Typography | Required text is at least 12px; compact secondary metadata may use 11px; zoom and 200% text do not hide actions | Pass at phone breakpoint | Mobile type floor added; 200% browser/device pass remains pre-production |
| Forms | Labels remain visible; correct input types; no focus zoom; errors appear next to fields | Prototype pass | KPI builder mobile capture |
| Modals | Full-screen on phone, independently scrollable, close/back remains reachable | Pass | Templates, share, drilldown, KPI builder QA |
| Tables | Preserve labels and actions; use contained horizontal scroll or stacked records | Pass | Drilldown table scrolls inside modal only |
| Charts | Retain headline value and accessible summary when chart detail compresses | Pass | Dashboard and TV preview captures |
| Keyboard | Focus is restored after modal close; Escape works with external keyboards | Pass | Browser interaction test |
| Screen reader | Names, roles, headings, source freshness, and status are announced meaningfully | Partial | Full VoiceOver/TalkBack audit required pre-production |
| Motion | `prefers-reduced-motion` removes nonessential transitions and celebration motion | Pass | CSS media rule |
| Color | Meaning is never conveyed only by pink/blue/green; text or icon accompanies state | Pass | Visual review |
| Safe areas | Fixed/sticky controls respect iOS safe-area insets | Pass in CSS | Header and page bottom use `env(safe-area-inset-*)` |
| Network | Slow/stale/offline states retain last-known-good value and visible timestamp | Specified | Backend implementation pending |
| Authentication | Session expiry and OAuth return paths recover without losing the draft | Specified | Backend implementation pending |
| Performance | Mobile LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at p75 | Required pre-production | Add real-user monitoring |

## Route-by-route usage worksheet

| Surface | Primary phone task | Phone layout behavior | Acceptance test | Beta status |
| --- | --- | --- | --- | --- |
| Dashboards | Scan KPI health and open lineage | KPI cards stack; toolbar scrolls; charts fit width | Open every KPI, return focus, no page overflow | Pass at 390px |
| Integrations | Check health, start fresh OAuth, and configure a mapping | Blank-source cards stack; OAuth and source/data/display builders become full-screen | Start fresh Google and HubSpot flows; verify no credential reuse | Pass at 390px |
| TV & Displays | Pair/wake a screen and edit loop | Devices stack; loop editor follows screens; actions are full-width | Pair code, preview loop, save loop | Pass at 390px |
| Automations | Pause a rule and inspect its outcomes | Rule flow stacks vertically; guardrails follow rule list | Toggle, create draft, open run log | Pass at 390px |
| Celebration HQ | Check goal and replay/preview a win | Metrics and wins stack; controls are non-sticky | Preview and close celebration with reduced motion | Pass at 390px |
| My Sounds | Select, preview, and assign sound | Library and inspector stack; rows hide decorative waveform first | Select sound, preview, save | Pass at 390px |
| Kombat Studio | Check match and make a critical change | Stage first; steps hidden; inspector stacks below | Rename teams, change score/arena, preview | Pass at 390px |
| Brand Studio | Preview and publish theme | Preview precedes form; controls stack | Change workspace/color/language and publish | Pass at 390px |
| Workspace Admin | Onboard, invite, inspect usage, and request support | Checklist, usage, members, health, and support stack into one column | Complete onboarding draft, open roles/billing/support | Pass at 390px |

## Blank-customer mobile test

| Task | Expected phone behavior | Evidence |
| --- | --- | --- |
| Open Murphy Door | Blank KPI state is the first dashboard content; CTAs stack without overflow | `murphy-blank-dashboard-mobile.png` |
| Start Google OAuth | Full-screen workflow shows tenant, attempt, credential-reuse block, and prototype boundary | `murphy-fresh-oauth-mobile.png` |
| Start HubSpot after Google | Flow returns to preflight with a new attempt rather than cached consent state | Browser assertion: attempts 1 then 2 |
| Load synthetic KPIs | Persistent synthetic-data banner appears before KPI cards | Desktop and 390px browser assertions |
| Reset workspace | Returns to no KPIs/no connections and clears ephemeral OAuth attempt state | Browser persistence/reset assertion |
| Traverse all routes | No document-level horizontal overflow | Nine-route 390×844 browser matrix |

## Workflow worksheet template

Copy this block into a feature ticket before implementation:

```text
Feature:
Mobile user:
Context (walking, one hand, bright light, weak network, urgent):
Primary task:
Success signal:
Required information:
Required actions:
What can be deferred from phone:
Smallest viewport:
Touch-target check:
Keyboard/focus check:
Screen-reader names/status:
Slow/stale/offline behavior:
Session-expiry behavior:
Screenshots (320 / 390 / 430 / tablet):
Known limitations:
Owner and due date:
Release decision: Pass / Blocked / Explicit exception
```

## Mobile interaction rules

- Put the outcome first: headline value, status, freshness, then detail.
- One primary action per mobile view; secondary actions may live in an overflow menu.
- Never require hover, drag-only input, or a precision gesture. Every draggable item needs move up/down controls in production.
- Keep destructive or publish actions distinct and confirm scope before execution.
- Use native inputs and selectors where possible; preserve draft state through OAuth handoffs.
- Do not put essential labels only inside placeholders.
- Place validation beside the field and focus the first invalid field after submit.
- For dense source data, keep the KPI summary fixed in meaning even if the record table scrolls.
- Celebration audio must respect mute, volume, quiet hours, reduced motion, and browser autoplay policy.
- TV pairing codes must be readable, copyable, short-lived, and never expose a device credential.

## Weak-network and recovery worksheet

| Condition | Required behavior | Detection |
| --- | --- | --- |
| Offline at launch | Show last-known-good dashboard with timestamp or a clear offline state | Browser offline test |
| Connection drops mid-edit | Keep local draft and retry save idempotently | Forced network interruption |
| Metric refresh delayed | Keep prior value, show stale badge and age, block automation by default | Simulated freshness breach |
| OAuth expires | Explain affected KPIs, reconnect in place, preserve configuration | Revoked test token |
| Snapshot delivery fails | Show destination-specific failure and retry only that destination | Mock 429/500 response |
| Screen heartbeat stops | Mark offline after threshold and notify designated admin | Suppress heartbeat |
| Session expires in modal | Reauthenticate and return to the same step with draft intact | Short test session |

## Release gate

A mobile release passes only when:

1. All required viewports have no document-level horizontal overflow.
2. Every critical task completes at 390px without switching to desktop.
3. Repeated/primary targets meet 44×44px; no action depends on hover or drag alone.
4. Modals, tables, charts, form errors, keyboard focus, and reduced motion pass.
5. Chromium automation has zero page errors and current screenshots are attached.
6. VoiceOver on iOS and TalkBack on Android complete the critical-task smoke test before production.
7. Any exception names the owner, workaround, user impact, and explicit approval.

## Current beta evidence

Evidence is stored in `artifacts/qa/`. The beta is a static interaction prototype: responsive layout is testable now, while real offline recovery, OAuth resumption, performance telemetry, and physical iOS/Android assistive-technology testing become gates when the production shell exists. All 20 reusable feature-workflow families also pass at 390×844 with zero document overflow, zero undersized visible buttons, and no unclassified workflow controls.
