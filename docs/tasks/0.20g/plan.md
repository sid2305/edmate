
# 0.20g plan — e2e flake: cold route compile stalls the first chat test

## Task (board, verbatim)

> e2e flake: apps/web e2e/chat.spec.ts:43 "normal: a message gets a streamed, then final, reply"
> times out waiting for "Hello there!" (5 s) on the first chat test of the run; failed on PR #369
> and PR #372, passed on re-run. Likely the first streamed turn after a cold start (route compile
> or warm-up); find the cause and fix it or give the first turn a warm-up, without raising
> timeouts across the suite.

## Acceptance (verbatim) and how it is shown

> chat.spec.ts passes 10 runs in a row in CI-like conditions (or locally with the e2e command CI
> uses); the cause is written in the handoff.

Shown by: the handoff's `## Decisions`/body states the root cause (below) with the code evidence
for it, and either (a) 10 separate local invocations of the real `e2e` script, each with a freshly
started `next dev` (not `--repeat-each` inside one invocation — see "Proof", below), all green on
the first try, or (b) 10 green CI `e2e` job runs on the PR, each linked by run id/URL in the
handoff, if a local Postgres isn't reachable without docker/docker compose/psql.

## Root cause (read from the code, not a guess)

- `playwright.config.ts`: `fullyParallel: false`, `workers: 1`, default `expect` timeout (no
  override) — the suite's own comment already documents the mechanism generally: "Next dev
  compiles each route on its first visit; on a loaded CI/dev box that first compile can outlast a
  plain fill/press" (`fixtures.ts` lines 12-17, `chat.spec.ts` lines 22-26, repeated in
  `full-flow.spec.ts` lines 17-23).
- `fixtures.ts`'s `postOnce` only retries the *action* (fill/click) until the request has left the
  browser; it does not wait for that request's response. The very next line in every test is a
  bare `await expect(...).toContainText(...)`, which uses Playwright's default 5 s timeout (the
  "(5 s)" in the task title) — this is the step with no cold-start allowance.
- `chat.spec.ts`'s first test is also the **first visitor in the whole e2e run** of two real (not
  `page.route`-mocked) routes:
  - `GET /learn/[agentId]` (`apps/web/app/learn/[agentId]/page.tsx`) — the auth check
    (`requireRole`) runs *inside* the page component, after `page.tsx`'s full import graph
    (`ChatView`, `loadChat`, `AppShell`, next-intl, auth) has already loaded, so even a redirect
    pays full compile cost.
  - `POST /api/sessions` (`apps/web/app/api/sessions/route.ts`) — `withRole(['student'],
    sessionHandlers.startSession)`; same shape, the whole module (which the `playwright.config.ts`
    comment already flags as heavy: it transitively reaches `@edmate/db` → `pg` and queue/rate-limit
    code) compiles before the auth check runs.
  - Checked `a11y.spec.ts` (alphabetically first spec file, also runs in the same shared `next dev`
    process): it visits `/`, `/sign-in`, `/home`, `/teacher` — never `/learn/**` or
    `POST /api/sessions`. So nothing before `chat.spec.ts` warms either route; its first test pays
    the full first-compile cost of both, back to back, right before a bare 5 s assertion.
  - Later tests in the same file (and `full-flow.spec.ts`, which runs after) hit an already-warm
    server, which matches "passed on re-run" and the already-passing later tests in the same file.

This is the cold-route-compile cause the task predicted, pinned to the two specific routes.

## Fix (narrowest: a one-time warm-up in global setup, no timeout changes)

One file: `apps/web/e2e/global-setup.ts`.

- Playwright starts `webServer` before running `globalSetup`, so `globalSetup` may safely make
  HTTP requests to the running dev server (same guarantee the project already leans on implicitly
  via `assertLocalDatabaseUrl`/the CLI spawns).
- Add a `BASE_URL`/`PORT` pair to `global-setup.ts`, computed the same way
  `playwright.config.ts` does (`EDMATE_E2E_PORT ?? 3111`) — mirrors the existing duplicated-default
  pattern already used for `TEST_DATABASE_URL` in this same file, so no import is added from
  `global-setup.ts` to `playwright.config.ts` or vice versa.
- Add a small `warmRoutes()` function, called once at the end of `globalSetup()` (after
  `verifyDemoTeacher()`), that issues two plain `fetch()` calls (Node 22, no extra dependency):
  - `GET ${BASE_URL}/learn/demo-agent` (literal id, commented as mirroring `fixtures.ts`'s
    `DEMO_AGENT`/seed.ts's demo agent id — not imported, to avoid a new import cycle between
    `global-setup.ts` and `fixtures.ts`, which already imports *from* `global-setup.ts`).
  - `POST ${BASE_URL}/api/sessions` with a JSON content-type header and an empty/minimal body.
  - Both calls are **unauthenticated on purpose**: the expensive part is the module compile, which
    happens before either route's auth check runs (see Root cause); a 401/404/redirect response is
    fine and expected. Wrap each call in try/catch and swallow the error — a warm-up is best-effort
    and must never fail or flake the suite itself; the real tests still exercise these routes for
    real afterwards.
- No change to `playwright.config.ts`, no change to any `*.spec.ts` file, no suite-wide or
  per-test timeout change anywhere.

## Files to create/modify

- Modify: `apps/web/e2e/global-setup.ts` (add `BASE_URL` consts + `warmRoutes()`, call it from
  `globalSetup()`).

## Files out of bounds

- `.github/**` (read only, per the task).
- `apps/web/playwright.config.ts` (no change needed; keep the diff to one file).
- Any `*.spec.ts` file (no assertion or timeout changes).
- 8.2q's active files — `apps/web/src/studio/routes.ts`, `apps/web/src/storage/presign.ts`,
  `apps/worker/src/storage/roundtrip.ts`, the uploads page/`UploadsView` — **no overlap**: 0.20g
  touches only `apps/web/e2e/global-setup.ts`. Confirmed against 8.2q's board entry (branch
  `m13/8.2q-upload-hardening`, status running). No shared-file conflict; both can run in parallel.

## Risky paths touched

None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `apps/web/e2e/**` and
`apps/web/playwright.config.ts` are not listed. Board risk: low; no `risk: high` decision needed
for this PR.

## Tests first

There is no new unit test to write first — this is an e2e-infra fix, and the existing
`chat.spec.ts` "normal" test (and the rest of the suite, as a regression check) is the test. The
builder does not add a new spec; "first" here means: reproduce the cold-start failure once
(stop any lingering dev server on the e2e port, run the suite fresh, confirm the first test is the
one that is slow/flaky — or at least confirm the warm-up fetches land before any `*.spec.ts` file
runs by a log line) before relying on the fix.

## Proof (acceptance line)

`--repeat-each=N` inside **one** `playwright test` invocation is **not** sufficient proof: with
`reuseExistingServer: !process.env.CI` true locally, the first iteration's `next dev` server stays
up and warm for the remaining repeats, so only the first iteration ever faces a genuinely cold
server — exactly the case the bug is in.

- If a local Postgres is already reachable at `TEST_DATABASE_URL`'s default
  (`postgres://edmate:edmate-dev@127.0.0.1:55432/edmate`) without the builder running docker,
  docker compose or psql themselves (i.e. something else already has it up): run
  `corepack pnpm --filter @edmate/web build` once, then run the real CI command,
  `corepack pnpm --filter @edmate/web e2e`, **10 separate times** (a shell loop, 10 full process
  invocations — each one its own fresh `next dev` via Playwright's `webServer`), confirming
  `chat.spec.ts`'s "normal" test passes on try 1 every time. If connecting fails (connection
  refused), do not attempt to start Postgres (docker/compose/psql are off-limits); fall back to the
  CI proof below and say so in the handoff.
- Otherwise: push the branch, open the PR, let the first CI `e2e` job run, then trigger 9 more
  independent runs of that same job (`gh run rerun --job <e2e-job-id>` on the workflow run, repeated
  9 times, each a fresh job with its own Postgres service container and fresh `next dev` — the
  real cold-start condition) **without editing any `.github/**` file**. Link all 10 run URLs/ids in
  the handoff.

## Risks & mitigations

- **Risk**: the warm-up POST to `/api/sessions` has a side effect (creates a session/row) even
  unauthenticated. Mitigation: `withRole` should 401 before `sessionHandlers.startSession` runs;
  confirm this by checking the response status in a quick manual/local smoke check, and note the
  observed status in the handoff.
- **Risk**: the warm-up doesn't fully close the gap if compile time on a slow CI runner still
  exceeds whatever time is left before the first test's own 5 s assertion starts (the warm-up
  removes the *compile* cost from the test's own timing window entirely, by paying it earlier in
  `globalSetup`, so this should not happen — but if 10 CI runs still show one flake, say so in the
  handoff rather than silently adding a timeout bump, and raise it back to the board as a smaller
  follow-up rather than widening this task's scope).

## Open questions

- None that block planning. Whether a non-docker, already-running local Postgres exists for this
  builder to use is an operational check at build time, not a spec question — the proof path above
  covers both outcomes.

## Budget

Budget: 40 tool calls (1 phase, apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Bash (local build/test attempts, git, gh CLI for CI reruns, secret scan) —
no Write (only one existing file is edited); no docker, docker compose or psql.

## Exit conditions

Status: DONE when the root cause is written in the handoff with the code evidence above, the fix
lands as the single-file warm-up, and either 10/10 fresh local `e2e` invocations or 10/10 linked
green CI `e2e` runs are reported. Status: PARTIAL past ~40 tool calls, if the warm-up does not
clear the flake across the 10 runs (report what was tried and the remaining evidence), or if local
Postgres is unreachable and CI reruns can't be completed within budget (report how many were
attempted and queue the rest as a note for the lead).
