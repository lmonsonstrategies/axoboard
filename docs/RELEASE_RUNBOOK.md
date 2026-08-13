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
- `/`, `/signup`, `/login`, and `/demo` return the intended pages.
- Anonymous `/app` redirects to `/login`.
- sensitive probes such as `/.env`, `/server.mjs`, `/package.json`, `/Dockerfile`, and `/.git/config` return `404`.
- the public browser bundle contains no Murphy Door references or high-risk secret patterns.

## Rollback

Revert the failing release commit on `main` and push the revert. Railway will build the prior known-good code as a new traceable deployment. Do not rewrite `main` history or use a destructive Git reset.

## Credential boundary

- GitHub receives source code and placeholders only.
- Railway secrets live only in Railway variables and are never echoed into build logs.
- local operator credentials stay in the gitignored, mode-600 `.credentials` directory.
- provider OAuth tokens stay server-side, encrypted, tenant-scoped, and absent from browser payloads.
