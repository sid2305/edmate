# Handoff: 9.7a — E2E full flow, Phase A

## Summary
Picked up a cut-off builder's uncommitted WIP (one commit, "9.7a: WIP from a builder cut off by
the usage limit (not gated)") and finished it: reviewed the diff against `docs/tasks/9.7/plan.md`
Phase A, confirmed it matches the plan's chosen approach exactly (e2e-only teacher verification,
mocked chat turns, a real `teacherQuestions.open` row for the uncovered question, one new CI step
pair in the existing `node` job), ran the full gate and the Playwright suite locally, merged
`origin/main`, re-ran everything green, and pushed.

No new code was written beyond what the prior builder left — this run is verification, gating,
and the merge-forward, not new implementation.

## Files
- `apps/web/e2e/full-flow.spec.ts` (new): the ordered student/teacher spec, `test.step` per stage.
- `apps/web/e2e/fixtures.ts` (edit, additive): `DEMO_TEACHER`, `signInAsTeacher`,
  `signInAsFreshStudent`.
- `apps/web/e2e/global-setup.ts` (edit): verifies the demo teacher via a throwaway e2e-only staff
  user (`identity.createStudent` + `grantRole` + `teacherProfiles.setVerification`), guarded by
  `getUserByEmail` so re-runs against a persistent dev Postgres don't throw.
- `.github/workflows/ci.yml` (edit, risky): two new steps in the existing `node` job — "Install
  Playwright browsers" and "Student/teacher e2e (scripted turns)" — after the build-smoke step.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — 34/34 tasks green,
  before and after merging `origin/main`.
- `python3 .githooks/secret-scan.py --all` — clean, before and after the merge.

## e2e run evidence
Local run against a throwaway docker-compose Postgres (`docker compose -p edmate-97a -f
docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`, port 55432), built
`@edmate/db` (`migrate.js`/`seed.js`) and Chromium already cached from the prior builder's run:

```
corepack pnpm --filter @edmate/web e2e
...
  ✓  11 [chromium] › e2e/full-flow.spec.ts:62:1 › discover-less full flow: subscribe (free) -> learn -> locked -> uncovered question -> teacher answer (7.6s)
  12 passed (33.0s)
```
(After merging `origin/main`, which added `e2e/skills.spec.ts` from another task; all 12 specs —
10 `chat.spec.ts`, 1 `full-flow.spec.ts`, 1 `skills.spec.ts` — pass together.)

Not yet proven green in GitHub Actions itself (no Actions run was triggered from this branch); the
CI job change is added and locally verified against the same Postgres-only footprint the `node`
job already has.

## Fix round
Code-reviewer HIGH (retry re-sends a message) and its sibling, all in `apps/web/e2e/full-flow.spec.ts`:
- `sendMessageUntil` and `clickUntil` are gone. A new `postOnce(page, path, act)` runs the fill/click
  until that action's own POST has left the browser (a `page.on('request')` flag), and never again
  after. A click before hydration sends nothing and is retried. A click after it is never repeated,
  so each chat message uses exactly one `mockTurns` fixture and Start posts `/api/subscriptions`
  once. Each outcome (URL, reply text, notice) is then awaited on its own with a 30 s expect
  timeout, with no retry around it.
- The same pattern also covered the teacher's "Send answer" (a real POST), so it now uses `postOnce` too.
- Found while fixing: a fill before hydration leaves the DOM value equal to the text. React then
  ignores the same-value refill and its state stays empty, so Send did nothing on a cold
  `next dev`. Each fill now clears the box first.
- `fixtures.ts` is unchanged; no fixed sleeps.

e2e evidence (throwaway compose Postgres on 55432, fresh data dir; each run starts a cold `next dev`):
```
corepack pnpm --filter @edmate/web e2e full-flow.spec.ts   # x3 in a row
run 1  ✓ full-flow.spec.ts › discover-less full flow ... (14.7s)  1 passed
run 2  ✓ full-flow.spec.ts › discover-less full flow ... (13.6s)  1 passed
run 3  ✓ full-flow.spec.ts › discover-less full flow ... (10.4s)  1 passed
corepack pnpm --filter @edmate/web e2e                      # 12 passed (22.9s)
```
Note: the spec relies on a clean test DB. Each failed run leaves its seeded question open, and a
later run's `getByText(question)` then fails strict mode. CI always starts with a fresh database.

## Decisions

### 22 Oct 2026 · 9.7a CI runs the Playwright e2e suite in the node job · decided by builder · risk: high
- Decided: added two steps to the existing `.github/workflows/ci.yml` `node` job, after "Build
  smoke": "Install Playwright browsers" (`corepack pnpm --filter @edmate/web exec playwright
  install --with-deps chromium`) and "Student/teacher e2e (scripted turns)" (`corepack pnpm
  --filter @edmate/web e2e`). No new job, no new service, no new secret, no new permission and no
  third-party action — only the official `actions/checkout`/`actions/setup-node` already pinned in
  this job are used, and both new steps run shell commands through the repo's own pnpm/Playwright
  devDependency. `TEST_DATABASE_URL` is unchanged (the job's existing Postgres-only value); the
  suite needs no Redis, though the job already starts one for the worker's own tests.
  `playwright.config.ts`'s `testIgnore: ['stack/**']` keeps task 9.0's docker-compose stack suite
  out of this job, so only `chat.spec.ts`, `full-flow.spec.ts` and (after the `origin/main` merge)
  `skills.spec.ts` run here.
- Why: plan 9.7 open question 5 (accepted by the lead): reuses the job's existing
  Postgres/Redis services and `docs_only` skip gate instead of booting a second multi-minute
  service set in every PR.
- risk: high (`.github/**` is a risky path per `.claude/skills/merge-gate/risk-paths.txt`;
  security-reviewer is the required reviewer).

### 22 Oct 2026 · 9.7a demo teacher verification lives in e2e setup, not seed.ts · decided by builder · risk: medium
- Decided: `apps/web/e2e/global-setup.ts` creates a throwaway `@example.invalid` staff user and
  calls `teacherProfiles.setVerification` for the seeded demo teacher, after `migrate`/`seed`,
  guarded by `getUserByEmail` so a re-run against a persistent dev Postgres is a no-op rather than
  a unique-email error. `packages/db/src/seed.ts` is unchanged.
- Why: plan 9.7 open question 1 (accepted): `seed.ts` is shared by 1.5 and every other task's db
  fixtures; verifying there would silently change what `docs/try-it.md`'s manual "staff verifies
  the teacher" walkthrough demonstrates.
- risk: medium (new e2e-only side effect, no production code path, no shared fixture change).

### 22 Oct 2026 · 9.7a uncovered question seeded directly, no real pipeline run · decided by builder · risk: low
- Decided: the test calls `repos.teacherQuestions.open(...)` directly to create a real row, then
  mocks an SSE `teacher_question` event carrying that row's real id.
- Why: plan 9.7 open question 3 (accepted): running the real pipeline needs Redis and the
  worker's BullMQ queue (task 3.8), which 9.0 deliberately keeps out of the `node` CI job (that's
  `playwright.stack.config.ts`'s job instead).
- risk: low (test-only, no production code touched).

## Left to do
- GitHub Actions has not actually run this branch's CI job (no Actions trigger available from
  this environment); the lead should confirm a green Actions run on the PR before merging, per the
  plan's exit condition ("added, not yet proven green in CI unless the builder can trigger an
  Actions run from its branch").
- Non-blocking follow-up carried from the plan (open question 2): a student with `/learn/demo-
  agent` open in a tab when the teacher answers does not see the answer without a reload — no live
  push exists yet. Worth a short board task if the team wants one.
- Phase B (discover + upgrade stages) is explicitly out of scope here; it waits on 9.2c (now
  merged to `main`, confirmed by the `origin/main` merge pulling in `apps/web/app/teachers/page.
  tsx`) and 9.6 (subscription upgrade), per the plan's build order.

Status: DONE
Tool calls used: 114 (harness: resumed build 54 + fix round 60; the cut-off first run is not counted)
