# AxoBoard feature interaction audit

Status: interactive beta audit  
Updated: 2026-08-12

## Outcome

The prototype contains 182 button instances at initial load. Every button now has an explicit runtime classification:

- **98 working interactions:** navigation, previews, filters, selectors, modal controls, builders, toggles, share controls, and other directly simulated behavior.
- **84 wireframed interactions:** controls that previously had no meaningful next state or only displayed a generic toast now open a feature-specific workflow.
- **0 unclassified/silent buttons.**

These classifications describe prototype behavior, not production backend completion. The runtime adds `data-interaction-status="working"` or `data-interaction-status="wireframed"` so QA can enforce the contract automatically.

## What was missing

| Product area | Previously incomplete controls | New wireframe |
| --- | --- | --- |
| Workspace/account | Workspace switcher and profile menu | Tenant-aware workspace chooser; profile, preferences, and security settings |
| Dashboard | Date range, layout editor, KPI menus, attention actions, alert configuration | Dashboard version workflow; KPI source/calculation/display workflow; alert builder |
| Integrations | Add source, connector catalog, manage connection | Connector selection/OAuth flow; health, mappings, permissions, and sync history |
| TV & Displays | Access, content assignment, screen overflow menus, wake controls | Screen identity, content, schedule, heartbeat, recovery, and admin notification workflow |
| Automations | New/edit rule and run-log controls | Trigger/action/guardrail/dry-run builder; observable run ledger and export |
| Celebrations | History, performers, wins list, and shoutout | Recognition composer with audience, destination, sound, and preview |
| My Sounds | Help, upload, favorites, event assignment, assignment removal | Upload/scan/ownership/loudness review plus trigger and audience assignment |
| Kombat Studio | Section navigation, preview modes, label editing, sprites, arenas, assets | Asset library, upload, mobile/TV safe zones, licensing, testing, and publish workflow |
| Brand Studio | Logo replacement and multi-step continuation | Identity, theme, language, accessibility, versioning, and rollback workflow |
| KPI drilldowns | CSV export and metric history | Version history, snapshot comparison, permitted export, and redaction policy |
| Workspace Admin | Customer onboarding, roles, plan usage, billing, service health, and support | Commercial-service workflows with tenant, entitlement, privacy, and support boundaries |

## Reusable workflow anatomy

Every feature workflow uses the same mobile-compatible structure:

```text
┌ Header: feature + outcome + close ┐
├ Progress: configure → test → save ┤
├ Main form / choices ┬ Context     ┤
│                     │ health      │
│                     │ permissions │
│                     │ impact      │
├ Cancel ─ status ─ primary action  ┤
```

The shell includes:

- explicit steps and draft status;
- primary and cancel actions;
- tenant/permission context;
- mobile full-screen behavior and contained scrolling;
- minimum 44×44px controls;
- failure, freshness, ownership, licensing, or rollback context where relevant;
- no implied live mutation: final actions save a prototype draft only.

## Feature families added

1. Workspace access
2. Profile and preferences
3. Dashboard configuration
4. KPI editing
5. Alert building
6. Connector setup
7. Connection management
8. Screen management
9. Automation editing
10. Automation run history
11. Celebration and recognition
12. Sound upload and assignment
13. Kombat asset customization
14. Brand publishing
15. Data export and metric history
16. Customer onboarding
17. Member and role management
18. Plan and billing management
19. Customer support
20. Guided customer setup

A generic governed workflow remains as a fallback for future prototype controls. It records configuration, mobile compatibility, auditability, permissions, failure behavior, and definition of done rather than allowing a silent click.

## Production priority

### P0 — Required for a credible pilot

- Dashboard editing, KPI editing, draft/preview/publish/rollback
- Google Sheets and HubSpot connection management
- Alert/automation builder with dry runs and idempotency
- Screen pairing, content assignment, heartbeat, and recovery
- Metric history and permission-aware drilldown

### P1 — Required for competitive completeness

- Secure export and scheduled delivery
- Sound upload/scanning/assignment
- Celebration composer and history
- Brand wizard and version rollback
- Automation run detail, destination retry, and replay controls

### P2 — Category differentiation

- Kombat asset library and customer uploads
- Outcome-recipe dependency resolution
- Cross-workspace personal preferences
- Certified metric definition/version comparison

## Release gate

A prototype update fails interaction QA if any visible button:

1. lacks `data-interaction-status` after initialization;
2. produces no visible state change, navigation, modal, selection, preview, or controlled feedback;
3. opens a workflow without an outcome, primary action, cancel path, or mobile state;
4. implies a live external action when only a prototype simulation exists;
5. becomes unreachable or undersized on the mobile viewport matrix.

## Verification evidence

- Runtime audit: 182 total, 98 working, 84 wireframed, 0 unclassified.
- Representative clicks passed across all 15 workflow families.
- Workflow step progression passed.
- Desktop data-history capture: `artifacts/qa/feature-workflow-data-desktop.png`.
- Mobile screen-management capture: `artifacts/qa/feature-workflow-screen-mobile.png`.
- Mobile workflow: zero document overflow and zero undersized visible buttons at 390×844.
- Browser page errors: none.

## Top failure modes

1. **A future button ships silently:** detect with the runtime classification assertion in browser QA.
2. **A wireframe is mistaken for production behavior:** keep draft language visible and track backend status separately from interaction status.
3. **Generic workflows replace product thinking:** promote frequently used fallback controls into a named feature family with exact permissions, data contract, errors, and success signal.
