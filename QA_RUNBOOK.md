# AxoBoard Apple-level UI QA gate

This harness is an independent, read-only release gate for AxoBoard. It audits hard browser quality constraints, produces repeatable visual evidence, and separates machine checks from expert design judgment. A high qualitative score can never cancel a hard failure.

## Fast path

```bash
npm ci --ignore-scripts
npm run qa:apple:list
npm run qa:apple:verify
```

`qa:apple:verify` proves the harness itself: syntax/tests, a deterministic 26-check good-fixture matrix, and a deliberate bad fixture that must trigger the expected hard rules. It does not certify the current AxoBoard product.

Run a focused local diagnostic without credentials or approved baselines:

```bash
node src/audit.mjs \
  --target local \
  --mode diagnostic \
  --no-baselines \
  --route home,login,app-auth-guard,tv-pairing \
  --viewport phone-375,desktop-1440,tv-1920
```

Run the fail-closed release gate after approved baselines and review evidence exist:

```bash
npm run qa:apple -- \
  --expert-review /absolute/path/expert-review.json \
  --human-evidence /absolute/path/authenticated-evidence.json
```

The gate starts AxoBoard on an OS-allocated loopback port. It never assumes a fixed port, never writes to production, clears database/provider/billing variables for its local child process, and blocks every browser request method except `GET`, `HEAD`, and `OPTIONS`.

## Inventory and selection

`config/quality-budgets.json` is the canonical route/state/viewport policy. Use either command without starting a server or browser:

```bash
npm run qa:apple:list
npm run qa:apple:dry-run
node src/audit.mjs --target fixture --dry-run --route fixture-app-empty --viewport phone-375 --theme dark
```

The product matrix covers:

| Surface | States | Supported themes | Representative sizes |
| --- | --- | --- | --- |
| Landing/marketing | home, features, integrations, pricing, FAQ | light | 320–1728 px |
| Authentication | login, signup step 1 | light | phone, tablet, desktop |
| App boundary | unauthenticated redirect | light | phone, desktop |
| TV | pairing empty | dark | landscape tablet, desktop, wide, 1920×1080 |
| Legal | privacy, terms | light | phone, desktop |
| Deterministic fixtures | landing, auth error, app empty/loading/error, TV live | light and dark where supported | phone, tablet, desktop, TV |

Two authenticated scenario groups are intentionally fail-closed and human-only: authenticated app default/empty/loading/error states and paired-TV live/offline/stale/celebration states. They require a disposable non-production tenant with synthetic data. Production/customer credentials and live display tokens are prohibited. Start from `config/authenticated-evidence.template.json`.

## Quantitative gates

Every selected route/state/theme/viewport runs the same engine:

- Browser console errors, page exceptions, HTTP/resource failures, and attempted mutations.
- Horizontal overflow measured against `documentElement.clientWidth`, including mobile layout-viewport behavior.
- 44×44 px minimum interactive targets and accessible names.
- Axe WCAG checks, including color contrast and semantic relationships.
- Keyboard focus visibility, logical order, positive `tabindex`, offscreen focus, and traps.
- Exactly one visible main landmark, one visible H1, and ordered headings.
- Reduced-motion parity with a 100 ms maximum residual duration.
- Font readiness, font-settling geometry shifts, LCP, CLS, INP, and navigation budgets.
- Raster image density, body/TV typography, line length, sticky/fixed collisions, and same-origin link checks when requested.
- Two same-run screenshots compared at pixel level for deterministic stability.
- Approved visual-baseline comparison for checkpoint routes.

Budget values live in `config/quality-budgets.json`; their JSON Schema is `config/quality-budgets.schema.json`.

## Severity and release policy

| Severity | Meaning | Outcome |
| --- | --- | --- |
| P0 | Safety, privacy, mutation, or keyboard-trap failure | Always blocks |
| P1 | Broken route/runtime, WCAG serious/critical, overflow, core semantics, reduced-motion, baseline, or performance failure | Always blocks |
| P2 | Premium-fit issue such as line length, moderate Axe issue, or low qualitative score | Blocks Apple-level acceptance; does not override P0/P1 |
| P3 | Advisory polish issue | Reported for review |

Gate mode additionally blocks when any of these is absent:

1. Approved checkpoint baselines.
2. Independent expert review for every exact route/state/theme/viewport.
3. Reviewed disposable-tenant evidence for human-only authenticated scenarios.
4. A qualitative score of at least 4.0 with zero P2 findings.

Diagnostic and harness modes may omit those governance artifacts, but they still report hard findings and never rewrite baselines.

## Apple-level qualitative rubric

Each result contains a 0–5 evidence bundle for:

1. Hierarchy
2. Typography
3. Spacing rhythm
4. Alignment/grid
5. Density
6. Surface/material coherence
7. Icon consistency
8. Microcopy
9. Interaction states
10. Motion intent
11. Perceived polish
12. Brand distinctiveness

Automated values are labeled `automated-proxy`. The generated `expert-review-template.json` requires an independent reviewer to score every dimension and attach route-specific evidence. Missing dimensions, evidence, reviewer identity, timestamp, or approval make the gate fail.

## Visual baseline workflow

Normal runs never create or overwrite approved baselines. Missing/mismatched baselines are P1 findings.

Stage an intentional candidate:

```bash
node src/audit.mjs \
  --target local \
  --mode diagnostic \
  --propose-baselines \
  --reason "Approved navigation redesign" \
  --proposer "builder-name"
```

This writes, under the selected report directory:

- `baseline-candidates/*.png`
- `diffs/*.png` when an approved image exists
- `baseline-proposal.json` with old/new hashes, diff ratios, proposer, reason, and `pending-independent-review`
- `report.html`, `report.json`, and `artifact-manifest.json`

An independent reviewer first performs a dry run:

```bash
npm run qa:apple:baseline:approve -- \
  --manifest /absolute/path/baseline-proposal.json \
  --reviewer "reviewer-name" \
  --dry-run
```

After visual inspection, rerun without `--dry-run`. The tool refuses self-approval, verifies every candidate SHA-256, and writes approved images plus `approval-manifest.json` under `tests/apple-qa/baselines/approved/`. Commit those reviewed files explicitly.

## Artifact layout

Every browser run creates a unique directory under `reports/runs/` unless `--output` is provided:

```text
report.json                    full machine-readable result
findings.json                  flat findings list
report.html                    review UI with route/state scores
expert-review-template.json    independent review form
artifact-manifest.json         SHA-256 and size of every artifact
screenshots/                   primary captures
stability-repeat/              second deterministic captures
stability-diffs/               pixel diffs when unstable
baseline-candidates/           intentional proposals only
diffs/                         approved-vs-current visual diffs
baseline-proposal.json         intentional proposal manifest
```

Reports intentionally store the server identity as `local-product-server:ephemeral` or `fixture-server:ephemeral`; they do not persist transient port numbers or credentials.

## External candidate mode

Use external mode only for an explicitly approved public/local origin. The allowlist accepts `https://axoboard.io` and loopback origins; credentials and URL paths are rejected.

```bash
AXOBOARD_BASE_URL=https://axoboard.io npm run qa:apple:candidate
```

This remains read-only. Prefer the isolated local runner whenever it can prove the surface.

## Common failures

- `visual.baseline-missing`: stage a proposal, obtain independent review, then approve it.
- `qualitative.expert-review-missing`: complete the generated template with screenshots and interaction evidence.
- `coverage.authenticated-states-unverified`: run the human checklist against a disposable synthetic tenant; never substitute customer credentials.
- `runtime.console-error` on font preconnect: inspect CSP `connect-src` and the console evidence in `report.json`.
- `typography.font-layout-shift`: self-host or preload fonts with metric-compatible fallbacks; verify the geometry-shift evidence.
- `visual.screenshot-instability`: remove clocks/random data, add a deterministic QA state, or fix JS-driven motion. Do not raise the threshold to hide instability.

## Rollback

This harness is additive. Revert its commit without touching product history:

```bash
git revert <apple-qa-commit>
```

Do not use a hard reset in a shared checkout. Generated `reports/runs/` output is ignored and may be retained for review.
