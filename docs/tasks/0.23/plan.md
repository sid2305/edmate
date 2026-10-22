# Plan: 0.23 — CI node job inside its time limit

Written by the lead (small CI-only task, 22 Oct 2026).

## Problem
Since 9.7a the `node` job in `.github/workflows/ci.yml` also installs Playwright's Chromium and runs the full-flow e2e. The job's `timeout-minutes: 20` is now too tight: PR #188's node job was cancelled twice at "Install Playwright browsers" after about 20 minutes.

## Change (only `.github/workflows/ci.yml`)
1. Move "Install Playwright browsers" and "Student/teacher e2e (scripted turns)" into a new `e2e` job: `needs: changes`, same `if:` as `node`, `runs-on: ubuntu-latest`, `timeout-minutes: 20`, its own Postgres service (same pinned image, env and health check as `node`; Redis only if the e2e needs it — check `apps/web/playwright.config.ts` and `apps/web/e2e/global-setup.ts`), the same checkout and setup-node steps (pinned SHAs, `persist-credentials: false`), `corepack pnpm install --frozen-lockfile`, and whatever build the e2e's global setup needs (e.g. `turbo run build --filter=@edmate/web...` if it imports built packages; confirm by running it locally).
2. Cache the Playwright browsers with `actions/cache` pinned by full commit SHA (key on the runner OS and the installed `@playwright/test` version from the lockfile); on a cache hit run only `playwright install-deps chromium`.
3. Leave `node` with build, typecheck, lint, test and build-smoke; raise its `timeout-minutes` to 25 only if a local estimate says it needs it (say why in Decisions).
4. If the merge gate's required checks list job names anywhere in the repo (`grep -rn "python-harness" .github .claude/skills/merge-gate`), add `e2e` where `node` is listed, or note in Left to do that the human must add `e2e` as a required status check in the GitHub branch rule (never change repo settings yourself).

## Rules
- No other files. No new third-party actions beyond `actions/cache`, pinned by SHA. No secrets; the Postgres password stays the throwaway `edmate-ci`.
- Risky path `.github/**` → security-reviewer; the handoff logs a `risk: high` decision naming it.
- Verify the YAML parses (`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`) and, if available, `actionlint`. The real proof is the PR's own CI run: both jobs green and each well inside its limit.

## Budget
Budget: 30 tool calls.
