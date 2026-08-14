# AxoBoard release runbook

## Publishing flow

```text
feature/fix branch → focused local tests → push → parallel remote CI
              → one-command fast-forward → main CI → Railway exact SHA
              → automated production verification → release complete
```

Railway production follows only `main`. Feature branches never deploy to `axoboard.io`.

## Normal release

1. Create a focused branch: `feat/<short-name>` or `fix/<short-name>` from current `origin/main`.
2. Preserve unrelated work and run the smallest relevant local tests while editing.
3. Before the final commit, run `npm run verify` once. Use local Docker/Gitleaks only when changing the image, dependencies, build pipeline, auth, secrets, or deployment surface; CI always runs all three gates.
4. Commit and push the branch. GitHub runs PostgreSQL tests, the full-history secret scan, and the cached production-image build in parallel.
5. Run `npm run release:check` for a read-only release preflight.
6. Run `npm run release` to fast-forward the exact CI-passed SHA to `main`, wait for main CI and Railway, and verify production automatically.

The release command refuses dirty worktrees, stale branches, non-fast-forward promotion, unpushed commits, and feature SHAs without successful CI. It never force-pushes.

## Risk-tiered local validation

- Copy/docs/style-only: syntax check plus focused browser/layout proof.
- Provider or API behavior: focused provider/integration suite, then `npm run verify` once.
- Database, auth, billing, tenant boundaries, migrations, dependencies, Docker, or CI: full local suite plus the relevant infrastructure proof.
- Every pushed branch still receives the same remote test, secret, and image gates; risk tiers only prevent wasteful local repetition.

The release script polls GitHub Actions and `/healthz`, so read-only status checks need no Railway or GitHub token. Git push authentication remains the only publishing credential.

Database migrations run automatically before the HTTP listener starts. Each migration is transactional, serialized with an advisory lock, and checksum-verified against `schema_migrations`. A migration failure prevents the new container from becoming healthy; Railway retains the prior healthy deployment for rollback. Never modify an applied migration file.

## Production success signal

- `/healthz` returns `200`, `ok: true`, the expected commit SHA, and a healthy database when persistence is enabled.
- `/`, `/signup`, and `/login` return the intended public pages.
- Anonymous `/app` redirects to `/login`.
- Authenticated workspaces with `pending_payment`, `past_due`, or `canceled` status redirect from `/app` to `/pricing?access=subscription_required`.
- Only a workspace with explicit `active` subscription status can load `/app`, `/app.js`, and `/styles.css`; roles never grant paid access.
- `/demo`, `/index.html`, and anonymous requests for `/app.js` and `/styles.css` return `404`.
- sensitive probes such as `/.env`, `/server.mjs`, `/package.json`, `/Dockerfile`, and `/.git/config` return `404`.
- the public browser bundle contains no Murphy Door references or high-risk secret patterns.

New workspaces start in `pending_payment` and fail closed until Stripe's signed webhook projection activates them. Manual entitlement changes must be explicit, auditable, and limited to approved test accounts; do not activate a workspace merely because its member is an owner or administrator.
Every subscription insert and status transition is appended to `subscription_status_events` with its previous/new state, source, actor, workspace, and timestamp.

The PostgreSQL-backed CI suite proves `pending_payment`, `active`, `past_due`, `canceled`, mixed-workspace session binding, private product caching, entitlement history, Stripe webhook behavior, and the Google Sheets connection/KPI contract. Production verification intentionally stays read-only; controlled sandbox purchase and signed entitlement drills use the retained QA workspace.

Google Sheets must remain `not_configured` until all four Railway variables are present. Before enabling customer consent, require a fresh AxoBoard-owned Google application, exact callback registration, Sheets API enablement, a new production encryption key, and a test-user consent pass. A swapped workspace/connection ID must return `403` before any Google request.

## Rollback

Revert the failing release commit on `main` and push the revert. Railway will build the prior known-good code as a new traceable deployment. Do not rewrite `main` history or use a destructive Git reset.

## Credential boundary

- GitHub receives source code and placeholders only.
- Railway secrets live only in Railway variables and are never echoed into build logs.
- local operator credentials stay in the gitignored, mode-600 `.credentials` directory.
- provider OAuth tokens stay server-side, encrypted, tenant-scoped, and absent from browser payloads.
