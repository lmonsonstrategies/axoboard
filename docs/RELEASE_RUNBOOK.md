# AxoBoard release runbook

## Publishing flow

```text
feature branch → npm run verify → secret scan → pull request / review
              → merge to main → Railway builds exact main SHA
              → health + route + security verification → release complete
```

Railway production follows only `main`. Feature branches never deploy to `axoboard.io`.

## Normal release

1. Create a focused branch: `feat/<short-name>` or `fix/<short-name>`.
2. Preserve unrelated work and keep commits scoped to one release outcome.
3. Run `npm run verify` and `docker build -t axoboard:release .`.
4. Run the pinned Gitleaks history and worktree scans.
5. Push the branch and let GitHub Actions pass.
6. Merge the verified commit to `main`; do not force-push production.
7. Confirm Railway reports the same full Git SHA with deployment status `SUCCESS`.
8. Run `EXPECTED_SHA=<short-sha> npm run verify:production`.

## Production success signal

- `/healthz` returns `200`, `ok: true`, the expected commit SHA, and a healthy database when persistence is enabled.
- `/`, `/signup`, and `/login` return the intended public pages.
- Anonymous `/app` redirects to `/login`.
- Authenticated workspaces with `pending_payment`, `past_due`, or `canceled` status redirect from `/app` to `/pricing?access=subscription_required`.
- Only a workspace with explicit `active` subscription status can load `/app`, `/app.js`, and `/styles.css`; roles never grant paid access.
- `/demo`, `/index.html`, and anonymous requests for `/app.js` and `/styles.css` return `404`.
- sensitive probes such as `/.env`, `/server.mjs`, `/package.json`, `/Dockerfile`, and `/.git/config` return `404`.
- the public browser bundle contains no Murphy Door references or high-risk secret patterns.

Until Stripe webhooks are implemented, new workspaces start in `pending_payment` and fail closed. Manual entitlement changes must be explicit, auditable, and limited to approved test accounts; do not activate a workspace merely because its member is an owner or administrator.
Every subscription insert and status transition is appended to `subscription_status_events` with its previous/new state, source, actor, workspace, and timestamp.

The PostgreSQL-backed CI smoke suite proves `pending_payment`, `active`, `past_due`, `canceled`, mixed-workspace session binding, private product caching, and entitlement-history behavior. Production verification intentionally stays read-only: it proves anonymous denial and direct-file/API bypass protection but does not mutate live subscriptions or create test customers. Add Stripe test-mode checkout/webhook verification before enabling self-service billing.

## Rollback

Revert the failing release commit on `main` and push the revert. Railway will build the prior known-good code as a new traceable deployment. Do not rewrite `main` history or use a destructive Git reset.

## Credential boundary

- GitHub receives source code and placeholders only.
- Railway secrets live only in Railway variables and are never echoed into build logs.
- local operator credentials stay in the gitignored, mode-600 `.credentials` directory.
- provider OAuth tokens stay server-side, encrypted, tenant-scoped, and absent from browser payloads.
