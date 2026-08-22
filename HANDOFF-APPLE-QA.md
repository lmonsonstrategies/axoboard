# Handoff — AxoBoard Apple UI QA hardening

## Delivery

- Workspace: `/home/ops/.openclaw/workspace-personal/projects/axoboard-apple-qa`
- Branch: `feat/apple-ui-qa`
- Original base: `63877ddd82ba666ffcee80d0b6a0403e5b6e9aac`
- Latest integrated `origin/main`: `e29bcf8b341bf4f05e773eefc2d482582fdb0fb2`, merged by `3366997`
- Evidence/browser hardening: `274f158`; performance-order fix: `377c34f`
- Transport: the feature branch was pushed; `main`, Railway, production, credentials, and customer data were not mutated or accessed.

## Outcome

The gate now proves its browser claim in real Chromium, Firefox, and WebKit. Gate and harness modes cannot omit an engine; missing, failed, or incomplete engine coverage fails closed. Browser identity flows through results, findings, screenshots, baselines, expert review, reports, and artifact manifests. A dedicated CI job installs all three engines plus their host dependencies and executes the complete deterministic gate.

Authenticated evidence is schema-validated and derived from artifacts instead of trusting a `passed` flag. Every scenario is bound to the exact candidate SHA, audited origin, synthetic tenant/workspace, run ID, required state/role/device/theme/viewport matrix, canonical fresh timestamps, and regular non-symlink files with exact byte size and SHA-256. Traversal, tampering, stale/future evidence, wrong bindings, duplicate manifests, and artifact reuse fail closed. The former unrelated-good-manifest false-certification pattern is an explicit regression test.

The current product remains intentionally uncertified. Its last focused diagnostic found 19 P1 and 23 P2 issues; that historical result was not rerun against this branch. Release certification still requires a disposable synthetic tenant, independently approved browser-specific baselines, and an independent expert review for the exact candidate.

## Verification proof

- Exact code SHA `377c34fe3b0e47d20f51b3c356759eed0ae2e943`: [GitHub Actions run 32540180602](https://github.com/lmonsonstrategies/axoboard/actions/runs/32540180602) passed `apple-qa`, `test`, `secrets`, and `image`.
- Apple QA CI: 36 syntax modules; 21/21 tests; good fixture 78/78 checks (26 each in Chromium, Firefox, and WebKit) with zero P0–P3; deliberate bad fixture detected every required hard rule in every engine.
- Product verification: disposable PostgreSQL, all six database-suite receipts, provenance scan of 211 files, zero dependency vulnerabilities, and production Docker image build all passed.
- Adversarial evidence coverage: valid proof; old false-certification attack; tamper/size drift; traversal/symlink; wrong matrix/SHA/origin/tenant/time; reused manifest/artifact.
- Local Chromium and Firefox diagnostics passed. Local WebKit correctly failed closed because its host libraries are absent; CI installed those dependencies and supplied the authoritative three-engine proof.

## File manifest

- Evidence contract: schemas, validator, and adversarial tests — 450 lines total.
- Runner and browser result pipeline: `src/audit.mjs`, `src/page-audit.mjs`, `src/report.mjs`, `src/detectors.mjs` — 1,542 lines total.
- Policy and CI: quality config/schema, Playwright config, package scripts, and workflow — 483 lines total.
- Operator artifacts: `QA_RUNBOOK.md` 215, this handoff 47, `.state.md` 311, verification summary 87 — 660 lines total.

## Human blockers and rollback

Human-only inputs are: (1) a disposable non-production synthetic tenant/display token, (2) independently approved browser-specific visual baselines, and (3) exact-candidate expert review. Customer credentials and production display tokens are prohibited.

Use ordinary revert commits; never rewrite shared history:

```bash
git revert --no-edit 377c34fe3b0e47d20f51b3c356759eed0ae2e943
git revert -m 1 --no-edit 33669974e0bced74b54ad6750c150b4a78ec626d
git revert --no-edit 274f15832099321281e067bbfd752afd1dd6bc42
```

The merge revert is only needed if the integrated mainline changes must also be removed. Independent promotion review remains mandatory.
