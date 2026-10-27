# Handoff: 0.20g

Status: DONE

## Summary

Root cause (confirmed from code, matching the plan): `chat.spec.ts`'s first test is the first
visitor in the whole e2e run of two real routes — `GET /learn/[agentId]`
(`apps/web/app/learn/[agentId]/page.tsx`) and `POST /api/sessions`
(`apps/web/app/api/sessions/route.ts`). Both routes' auth checks run after `next dev` compiles
their full import graph on first visit, and `fixtures.ts`'s `postOnce` only waits for the action to
leave the browser, not for the response — the very next line is a bare `await
expect(...).toContainText(...)` on Playwright's default 5 s timeout. `a11y.spec.ts` (alphabetically
first, same shared `next dev` process) never visits `/learn/**` or `POST /api/sessions`, so nothing
warms either route before `chat.spec.ts`'s first test pays the full cold-compile cost of both,
back to back, right before that bare 5 s assertion.

Playwright ordering evidence (read, not guessed): in the installed
`playwright@1.64.1` package's bundled runner
(`node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/lib/runner/index.js`),
`createGlobalSetupTasks` (line 6509) builds its task list as
`[createRemoveOutputDirsTask(), ...createPluginSetupTasks(config2), ...globalTeardowns,
...globalSetups]` (lines 6510–6515) — `createPluginSetupTasks` (the `webServer` plugin's `setup()`,
which starts the dev server and waits for it to be healthy, confirmed by the
`WebServerPlugin.setup`/timeout logic at lines 837–954) runs strictly before
`createGlobalSetupTask` (the user's `global-setup.ts` export, lines 6557–6575) in that same array.
`webServerPluginsForConfig(config2)` pushes the `webServer` plugin into `config2.plugins` (lines
1000–1014, 7098, 7130), which is exactly what `createPluginSetupTasks` iterates. So Playwright's
`webServer` is always started and awaited before `globalSetup` runs — safe to `fetch()` the running
dev server from `global-setup.ts`.

Fix (single file, no timeout changes): `apps/web/e2e/global-setup.ts` — added `PORT`/`BASE_URL`
consts mirroring `playwright.config.ts`'s own `EDMATE_E2E_PORT ?? 3111` default (not imported, same
duplicated-default pattern already used there for `TEST_DATABASE_URL`), a literal `DEMO_AGENT_ID =
'demo-agent'` (not imported from `fixtures.ts`, which already imports *from* this file, to avoid a
cycle), and a `warmRoutes()` function called once at the end of `globalSetup()` after
`verifyDemoTeacher()`. It issues one unauthenticated `fetch(GET /learn/demo-agent)` and one
unauthenticated `fetch(POST /api/sessions, {...})`, each wrapped in its own try/catch that only
`console.warn`s on failure — best-effort, never fails the run. No change to
`playwright.config.ts` or any `*.spec.ts` file.

Risk check (plan's "Risks & mitigations"): read `apps/web/src/auth/guard.ts` — `withRole`
(line 147) returns `apiError('unauthorized', ..., 401)` before `sessionHandlers.startSession`
(the handler that would write a row) ever runs; an unauthenticated `POST /api/sessions` cannot
create a session. (The guard's own comment, line 122, also notes an unsafe method with no
same-origin signal can get a 403 even earlier — either way, no DB write.)

Local proof: `TEST_DATABASE_URL`'s default Postgres (`127.0.0.1:55432`) was already reachable
without docker/compose/psql (checked with a plain `node net.createConnection` probe, no `psql`
run). Ran `corepack pnpm --filter @edmate/web build` once, then the real CI command,
`corepack pnpm --filter @edmate/web e2e`, **10 separate full process invocations** (each its own
fresh `next dev` via Playwright's `webServer`, not `--repeat-each`). `chat.spec.ts`'s "normal: a
message gets a streamed, then final, reply" test passed on try 1 in **all 10/10 runs** — it never
appears in any run's failure list.

Unrelated finding, out of scope: in all 10 runs, `full-flow.spec.ts`'s "discover: search, open the
teacher page, choose a package" step failed deterministically (10/10, not intermittently) with a
`Timeout 30000ms` inside its own `navigateUntil`/`toPass({ timeout: STEP_TIMEOUT })` wrapper — i.e.
a step that already has its own cold-start allowance, still failing every time, which looks like a
separate, pre-existing bug rather than the cold-compile flake this task targets. `teacher-packages-
walkthrough.spec.ts`'s "create the first/second package from preset" step also failed in 6 of the
10 runs. Neither is `chat.spec.ts`, neither file was touched (both are out of bounds per the plan),
and this task's one-file diff (try/catch-wrapped, best-effort `fetch()` calls added to
`global-setup.ts`) cannot plausibly reach either failure's code path. Flagging for the lead as a
separate board item rather than widening this task's scope.

## Decisions

### 27 Oct 2026 · 0.20g confirmed webServer-before-globalSetup ordering from source · decided by builder · risk: low
- Decided: Built the fix on the plan's assumption (webServer starts before globalSetup) after
  confirming it directly in the installed Playwright runner source (see Summary); no change to the
  plan's approach was needed.
- Why: The plan asked the builder to verify this before relying on it; recorded here as the
  concrete evidence rather than a guess.

### 27 Oct 2026 · 0.20g deterministic full-flow/teacher-packages failures found but not fixed · decided by builder · risk: low
- Decided: Left `full-flow.spec.ts` and `teacher-packages-walkthrough.spec.ts` untouched; reporting
  their deterministic (not intermittent) failures to the lead as a separate follow-up rather than
  investigating or fixing them here.
- Why: Both files are out of bounds for this task's narrow one-file fix, the failures are
  unrelated in shape (deterministic, inside a step that already has its own cold-start timeout
  wrapper) to the cold-route-compile flake this task targets, and the budget (~40 tool calls) does
  not cover a second investigation.

## Gate

- `corepack pnpm turbo run typecheck lint --filter=@edmate/web` — pass (0 errors; 2 pre-existing
  `no-console` warnings in `apps/web/test/lighthouse-a11y.test.ts`, unrelated to this change).
- `corepack pnpm exec prettier --check apps/web/e2e/global-setup.ts` — pass.
- `python3 .githooks/secret-scan.py --all` — pass (no output, clean).
- `corepack pnpm --filter @edmate/web build` — pass.
- `corepack pnpm --filter @edmate/web e2e` × 10 fresh invocations — `chat.spec.ts`'s "normal" test
  passed on try 1 in all 10/10; unrelated pre-existing failures in `full-flow.spec.ts` (10/10) and
  `teacher-packages-walkthrough.spec.ts` (6/10), reported above, not touched.

## Budget

Tool calls used: 36
