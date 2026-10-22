# Handoff: 0.23 — CI node job inside its time limit

## Summary
Split task 9.7's Playwright install + e2e run out of the `node` job into a new `e2e` job in
`.github/workflows/ci.yml`, so neither job hits a 20-minute timeout. `node` keeps build,
typecheck, lint, test and build-smoke (no timeout change needed; it was already well under 20
minutes before 9.7 added Playwright). `e2e` gets its own Postgres service (same pinned image, env
and health check as `node`; no Redis service, since `global-setup.ts`'s `REDIS_URL` is
syntactically valid but never actually reached — starting a session doesn't touch the queues),
the same checkout/setup-node steps, `pnpm install --frozen-lockfile`, a build of `@edmate/web` and
its workspace dependencies (needed because `global-setup.ts` spawns `packages/db`'s built
migrate/seed CLIs and the gateway reads its bundled `prices.yaml` at runtime), then installs
Playwright's Chromium (cached by OS + the `@playwright/test` version read out of
`pnpm-lock.yaml`), and runs the e2e suite.

## Files
- `.github/workflows/ci.yml` — only file changed.

## Tests (how I checked)
- `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` — parses clean.
- `actionlint` not installed in this environment; not run.
- `python3 .githooks/secret-scan.py --all` — clean.
- Manually verified the `@playwright/test` version-extraction command against the real
  `pnpm-lock.yaml` (`grep -m1 "^  '@playwright/test@" pnpm-lock.yaml | sed -E ...`) — prints
  `1.64.1`, matching `apps/web/package.json`'s pinned version.
- Did not run the e2e job itself locally (no Docker/Postgres service in this environment); the
  real proof is the PR's own CI run — both jobs green and each well inside its 20-minute limit.

## Decisions

### 22 Oct 2026 · 0.23 Split e2e into its own CI job · decided by builder · risk: high
- Decided: Move "Install Playwright browsers" and the e2e test run out of `node` into a new `e2e`
  job (`needs: changes`, same `if:`, `timeout-minutes: 20`, its own Postgres service, no Redis),
  with the Playwright browser cache (`actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830`,
  v4.3.0) keyed on `runner.os` and the `@playwright/test` version read from `pnpm-lock.yaml`;
  on a cache hit, only `playwright install-deps chromium` runs.
- Why: PR #188's `node` job was cancelled twice around 20 minutes at the Playwright install step;
  splitting the job (plus caching the browser binary) keeps both jobs inside their limits.
- risk: high (this is a `.github/**` workflow change; security-reviewer must review it).

### 22 Oct 2026 · 0.23 No Redis service in the e2e job · decided by builder · risk: low
- Decided: The new `e2e` job gets a Postgres service but no Redis service.
- Why: `apps/web/e2e/global-setup.ts` sets `REDIS_URL: 'redis://127.0.0.1:1'` on purpose
  (syntactically valid, unreachable) because starting a session never touches the turn queue in
  this suite — every turn is a `page.route` fixture. Adding an unused Redis service would only
  slow the job down for no test coverage gained.
- risk: low.

### 22 Oct 2026 · 0.23 `node`'s timeout-minutes left at 20 · decided by builder · risk: low
- Decided: Did not raise `node`'s `timeout-minutes` above 20.
- Why: `node` now runs only build, typecheck, lint, test and build-smoke — the same steps that
  ran comfortably inside 20 minutes before 9.7 added Playwright to this job. No local estimate
  suggested it needs more.
- risk: low.

## Left to do
- If the merge gate or any GitHub branch protection rule lists `node` as a required status check
  by name, the human needs to add `e2e` as a required check too (a repo setting; builders never
  change it). `grep -rn "python-harness" .github .claude/skills/merge-gate` found no file outside
  `ci.yml` itself that names job IDs as required checks, so there is nothing else in-repo to
  update — but the GitHub branch protection rule (not visible from this worktree) should be
  checked and updated if it lists job names explicitly.
- The real proof (both jobs green, each well inside its 20-minute limit) still needs this PR's own
  CI run, since this environment has no Docker/Postgres service to run the e2e job against.

Status: DONE
Tool calls used: 15
