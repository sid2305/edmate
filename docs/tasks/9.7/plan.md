# Plan: 9.7 — E2E: discover → free package → subscribe → learn → locked request → upgrade → unlocked → uncovered question → teacher answer

Planner: planner (22 Oct 2026). Status: **READY** on Phase A now; **Phase B waits** on 9.2c and 9.6
(both still open). No open decision blocks Phase A.

## Context (read, not re-derived)
- Build plan 9.7, accept: "green in CI with scripted gateway." Board deps list `1.3, 1.7, 8.9, 9.3,
  9.4, 9.5`; `8.9`, `9.3`, `9.4` are **done**. `9.5` (practice/feedback/mock-interview screens) is
  `todo`, but the literal flow in the title touches no skill screen — **recommend the lead drops
  9.5 from 9.7's deps** (open question 6).
- Playwright today (`apps/web/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/fixtures.ts`,
  `e2e/chat.spec.ts`, task 9.4 Phase D): real `next dev` + real Postgres (`TEST_DATABASE_URL`),
  seeded once by spawning `@edmate/db`'s built `migrate.js`/`seed.js` (the same rows `db:migrate`
  / `db:seed` write). Sign-in is a real DB session cookie (`identity.createSession`), never OAuth.
  The turn stream is always intercepted with `page.route('**/api/sessions/*/turns', …)` returning
  canned SSE bytes built from `TurnEvent` fixtures (`sseBody`/`mockTurns` in `fixtures.ts`) — **no
  real model call**, and today **not wired into CI**; the config's own comment says "9.7 adds that
  job." `playwright.stack.config.ts` (task 9.0) is a separate, CI-excluded path against a running
  docker-compose stack with a real key; 9.7 is not that.
- The seeded demo teacher (`packages/db/src/seed.ts`, `DEMO_IDS`): `teacherId: 'demo-teacher'`,
  one live agent `'demo-agent'`, a live **free** package (`DEMO_IDS.packageFree`) and a live
  **paid** package (`DEMO_IDS.packagePaid`), each already versioned and live — so "a free and a
  paid package without a real model, and with no real payment" needs no new seed content.
  **But `teacherProfiles` defaults `verificationStatus: 'pending'`** (`users.ts` schema default);
  `seed.ts`'s own `teacherProfiles` row sets no verification, so the demo teacher is **not**
  discoverable today (`discovery.ts`'s `search`/`getBySlug` both filter on `verified`, task 9.2a).
  A separate `discovery-seed.ts` (200 synthetic `verified` teachers, task 9.2) seeds teachers with
  **no course, module or style card** — "discovery shows them, but nothing can start a chat with
  one" (its own comment) — so it cannot stand in for the chat/locked/upgrade steps either.
  **Decision (open question 1): verify the demo teacher in the e2e setup itself**, not in
  `seed.ts` (shared by 1.5 and every other task that seeds): add one step to
  `apps/web/e2e/global-setup.ts` that, after `migrate`/`seed`, creates a throwaway staff user via
  `identity.createStudent` + `identity.grantRole({ by: 'operator', role: 'staff', … })` (the
  bootstrap value documented in `packages/db/src/identity/README.md` and used by
  `docs/try-it.md` step 2 — no existing staff user needed) and then calls
  `teacherProfiles.setVerification({ teacherId: DEMO_IDS... }, { status: 'verified', by: staff.id
  })`. Both calls are idempotent in effect (an update / a role grant), guarded by checking
  `getUserByEmail` first so a re-run against a persistent dev Postgres does not throw on the
  unique email.
- Subscribing has no payment already (9.3: `subscriptions.start`, `POST /api/subscriptions`,
  `PackageCompare.tsx` on `/packages/[agentId]`). **Upgrading does not exist yet**:
  `subscriptions.start` refuses a second live row for the same student×teacher pair (the
  one-live-row unique index → `invalid`/409 "already-subscribed" per 9.3b's follow-up), so a
  signed-in free subscriber cannot "start" the paid package again. The only path from free to paid
  is `subscriptions.changePackage` (9.6 Phase C, not built) through `PATCH /api/subscriptions/:id`
  and `/learn/[agentId]/plan` (9.6 Phase D, not built). **9.7's upgrade step is blocked on 9.6**,
  exactly as the task description says.
- Discovery UI: `/teachers` search (9.2b, **in review**, not yet on `main`) and
  `/teachers/[slug]` profile (9.2c, **todo**). Until both merge, 9.7 cannot start its browser at
  "discover" and must start at `/packages/demo-agent` directly (the page 9.3 already built).
- Teacher side already exists and is `done`: `8.9a`–`8.9c` (dismiss, API, inbox page at
  `/teacher/questions`), and `9.4`'s own accept line ("teacher answers in the thread"). The
  `teacherQuestions.answer` repository (5.10, `packages/db/src/repositories/teacher-questions.ts`)
  writes **one teacher message into the student's own *open* session** with that teacher/agent (no
  session is created or reopened) — so the student must have an **open session** at answer time,
  and the student's page must be **reloaded** to see it: `/learn/[agentId]` is a server component
  (`src/chat/loadChat.ts`) that reads `messages.history` fresh on every navigation; there is no
  live push from a teacher's answer into an already-open tab. 9.7 reloads between the teacher and
  student steps rather than assuming a live update (open question 2).
- "Uncovered question" in the real pipeline comes from `teacherQuestions.open`, called by the
  pipeline's `ask_teacher` move — but 9.7 never runs the real pipeline (model calls are mocked), so
  nothing opens a real `teacher_questions` row from the mocked SSE `teacher_question` event alone.
  **Decision (open question 3): seed the question directly.** The test calls the real
  `repos.teacherQuestions.open(studentScope, { agentId, text, similarIds: [] })` (same trust level
  as `fixtures.ts`'s existing direct `identity.createSession` call) to create a real, teacher-owned
  row tied to the real student and the real open session's teacher/agent, **then** mocks the SSE
  turn with a `{ type: 'teacher_question', questionId: <that row's id> }` event so the UI shows
  "Sent to your teacher" against a real id. The teacher's inbox, answer route and the student's
  reload all then operate on one real row — only the model's reply text is faked, never the
  question/answer state.
- CI: `.github/workflows/ci.yml`'s `node` job already runs Postgres **and** Redis services and
  `corepack pnpm turbo run build typecheck lint test`; `TEST_DATABASE_URL` is already set to that
  job's Postgres. Wiring in Playwright needs: installing the Chromium browser
  (`pnpm --filter @edmate/web exec playwright install --with-deps chromium`) and a new step running
  `corepack pnpm --filter @edmate/web e2e` (this reads `apps/web/playwright.config.ts`'s
  `testIgnore: ['stack/**']`, so it runs `chat.spec.ts` and 9.7's new spec, never the stack suite).
  **This edits `.github/workflows/ci.yml`, a risky path** (`.github/**` → security-reviewer).
- English-only pilot, US market (standing rules): the demo content is English only regardless of
  locale pack; the webServer leaves `EDMATE_MARKET` unset (defaults to `'global'` outside
  production, `deps.ts`'s `configuredMarket`), matching `playwright.config.ts`'s existing choice
  for `chat.spec.ts` — changing it is out of scope and would risk that suite's locale-dependent
  text (open question 4 touches this only if a reviewer asks for `US` explicitly).

## Acceptance (verbatim)
> green in CI with scripted gateway.

### How it will be shown
A single Playwright spec, `apps/web/e2e/full-flow.spec.ts`, walks one student and one teacher
(two `BrowserContext`s) through every named step and passes in the `node` CI job. No step calls a
real model or a real payment provider; every model-shaped answer is a `page.route`-intercepted SSE
fixture built with `sseBody`/`TurnEvent` (same pattern as `chat.spec.ts`); every other step (sign-
in, subscribing, the plan-change PATCH, the teacher's questions list and answer) is the real route
over the real seeded Postgres.

## Phases
**Phase A (ready now):** subscribe (free) → learn → locked request → uncovered question → teacher
answer, plus the CI job. Starts the browser at `/packages/demo-agent` (no discovery UI yet) and
ends there (no upgrade yet). Depends on nothing further (8.9, 9.3, 9.4 already on `main`).

**Phase B (waits on 9.2c and 9.6 merging to `main`):** edits the same spec to (1) prepend discover
— start at `/teachers`, search, open `/teachers/demo-teacher`, click through to `/packages/demo-
agent` — and (2) insert upgrade → unlocked between the locked-request step and the uncovered-
question step — navigate to `/learn/demo-agent/plan`, click **Upgrade**, follow the redirect to
`/learn/demo-agent` with no `?s=` (a fresh session on the paid package), then send one more
message and confirm no locked notice. Also extends `global-setup.ts`'s discovery discoverability
check if 9.2b/9.2c need the teacher's profile fields populated beyond verification (confirm against
their merged plans; expected to need nothing more).

One fresh builder per phase; Phase B reads this plan plus Phase A's handoff.

## Files
### Phase A — create
- `apps/web/e2e/full-flow.spec.ts`: the ordered test (`test.step` per named stage), using two
  `browser.newContext()`s (student, teacher). Stages: sign in as the seeded free-tier-capable
  student (reuse `signInAsStudent`/`DEMO_STUDENT`); `goto('/packages/demo-agent')`, start the free
  package (reuses 9.3's real route); `goto('/learn/demo-agent')`, send a message, mock a normal
  reply; send another, mock a `locked` event (package name from `content/demo-teacher`'s paid
  package `name`), assert the locked notice; seed a real `teacherQuestions.open` row (see Context)
  and mock a `teacher_question` event for a third message, assert "Sent to your teacher"; switch
  to the teacher context, sign in as `demo-teacher` (new fixture), `goto('/teacher/questions')`,
  assert the seeded question's text is visible, answer it through the real form; switch back to
  the student context, reload `/learn/demo-agent`, assert the teacher's answer text appears in the
  thread.
- `apps/web/e2e/fixtures.ts` (edit, additive only): add `signInAsTeacher(context, baseURL,
  userId = DEMO_TEACHER)` mirroring `signInAsStudent`, and export `DEMO_TEACHER = 'demo-teacher'`.
  No change to `mockTurns`/`sseBody`/`signInAsStudent`.
- `apps/web/e2e/global-setup.ts` (edit): after `seed.js`, create the throwaway e2e staff user and
  verify the demo teacher (see Context's Decision). Guard with a `getUserByEmail` check so re-runs
  against a persistent dev Postgres do not throw on the unique email; log nothing but the staff
  id's existence (no PII — the email is a fixed `@example.invalid` string, same convention as
  `seed.ts`).
- `.github/workflows/ci.yml` (edit, **risky**): in the existing `node` job, after "Build, typecheck,
  lint, test" and before (or after) "Build smoke," add "Install Playwright browsers"
  (`corepack pnpm --filter @edmate/web exec playwright install --with-deps chromium`) and "Student
  e2e (scripted turns)" (`corepack pnpm --filter @edmate/web e2e`), with
  `TEST_DATABASE_URL: postgres://edmate:edmate-ci@localhost:5432/edmate` (the job's existing value;
  no new env needed since the job already exports it). Keep the job's existing services; do not
  add a new job (avoids a second checkout/install and keeps one `docs_only` skip gate).

### Phase B — edit only
- `apps/web/e2e/full-flow.spec.ts`: insert the discover and upgrade stages (see Phases, above).
- `apps/web/e2e/fixtures.ts`: add a small helper only if 9.2c's profile page needs a specific
  selector not already covered (expected: none).

## Files out of bounds (both phases)
- `packages/db/src/seed.ts`, `discovery-seed.ts` (shared by many tasks; verification is done in
  the e2e setup instead — see Context).
- `packages/db/src/repositories/**`, `packages/harness/**`, `packages/contracts/**`: no new
  methods; the plan uses only repository and route surfaces other tasks already built.
- `apps/web/src/auth/**`: no new policy row; every route used (`/api/subscriptions`,
  `/api/subscriptions/:id`, `/teacher/questions` API, `/learn/**`, `/packages/**`, `/teachers/**`)
  already has one from its own task.
- `apps/web/playwright.config.ts`, `playwright.stack.config.ts`: no edit needed (new spec files
  under `e2e/` are already picked up; `testIgnore: ['stack/**']` already excludes the stack suite).
- Any UI file under 9.2b/9.2c's or 9.6's own scope (`/teachers/**` pages, `/learn/[agentId]/plan`):
  9.7 only consumes what those tasks build; if Phase B finds a selector or behaviour 9.7 needs that
  isn't there, stop and report rather than editing another task's page.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
| Path | Phase | Group | Reviewers required |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | A | harness/CI/hooks (`.github/**`) | security-reviewer |

No other planned path matches a glob in `risk-paths.txt`: `apps/web/e2e/**` and
`apps/web/playwright*.config.ts` are not listed; no `packages/db/src/repositories/**`,
`packages/harness/**`, `apps/web/src/auth/**`, `packages/contracts/**` or `packages/payments/**`
file is touched. Phase A logs a `risk: high` decision for the CI edit (the lead's precedent for
`.github/**` changes, e.g. 0.5, 0.9). Phase B touches no risky path (checked again once 9.2c/9.6's
final file lists are known — re-verify before merging Phase B, since those tasks may have added
new globs to `risk-paths.txt` in the meantime).

## Shared files, by phase
| Shared file | Phase | Other tasks/tests touching it |
| --- | --- | --- |
| `apps/web/e2e/global-setup.ts` | A | `chat.spec.ts` (9.4) runs the same setup; the new staff/verify step must not change its existing seed/migrate behaviour or break 9.4's tests |
| `apps/web/e2e/fixtures.ts` | A, B | `chat.spec.ts` (9.4) imports `signInAsStudent`, `mockTurns`, `sseBody`, `DEMO_AGENT`, `DEMO_STUDENT` — additive only, never change their signatures |
| `.github/workflows/ci.yml` | A | any task currently adding its own CI step (check for an open PR touching this file before starting; coordinate with the lead) |

## Decisions the builders log (planned, not open questions)
- The demo teacher's verification is set in e2e test setup, not in `packages/db/src/seed.ts` (open
  question 1, recommended answer taken).
- The student's chat turns stay fully mocked (`page.route`); only the question/answer and
  subscription state are real DB rows (open questions 2 and 3, recommended answers taken).
- No new CI job; one new step in the existing `node` job (open question 5, recommended answer
  taken).

## Open questions (each with a recommendation)
1. **Where to verify the demo teacher.** (a) In the e2e setup only (recommended above — no shared
   `seed.ts` edit, no effect on any other task's seeded state). (b) Change `seed.ts` to seed the
   demo teacher pre-verified. **Recommend (a)**: `seed.ts` is read by 1.5, every db test fixture,
   and the try-it guide's "staff verifies the teacher" step is a deliberate manual exercise of that
   flow (9.0) that (b) would silently skip.
2. **How the student sees the teacher's answer.** (a) Reload the student's page after the teacher
   answers (recommended — matches `loadChat.ts`'s real server-side read; no new polling or SSE
   push exists today). (b) Treat the lack of a live push as a gap and file a follow-up board task
   for a live-update mechanism. **Recommend (a)** for 9.7's own test, **and** file (b) as a short
   follow-up note in the handoff (not a blocker): a student with the chat tab open when the
   teacher answers does not see it without a reload today.
3. **How to create the "uncovered question" without a real model call.** (a) Call
   `teacherQuestions.open` directly in the test, then mock an SSE `teacher_question` event carrying
   that real id (recommended above). (b) Run the real pipeline through `EDMATE_DEV_MODEL=scripted`
   (task 9.0's dev-model adapter) so the `ask_teacher` move fires for real. **Recommend (a)**: (b)
   needs a *real* Redis and the worker's queue processors (the pipeline's `commit`/`meter` and the
   question-opening side effect run through BullMQ, task 3.8), which is exactly the stack-level
   setup `playwright.stack.config.ts` already covers and deliberately keeps out of CI (task 9.0's
   own comment: "not in CI, because it needs the stack up"). Mixing that into the `node` CI job
   would need a third CI service (a worker process) and contradicts 9.0's decision. (a) keeps 9.7
   inside the `node` job's existing Postgres-only footprint.
4. **Market/locale for the webServer.** Leave `EDMATE_MARKET` unset (defaults to `global` outside
   production), unchanged from `chat.spec.ts`. **Recommend** no change: the English-only pilot
   decision governs production config and prompt-pack language, not this test's locale pack
   choice, and the demo content is English regardless.
5. **One CI job or a new one.** (a) Add two steps to the existing `node` job (recommended — reuses
   its Postgres/Redis services, its `docs_only` skip gate, and its single checkout/install; the
   e2e suite does not need Redis, but the job already starts one for the worker's own tests). (b) A
   separate `e2e` job with its own Postgres service. **Recommend (a)**: it is a smaller diff to a
   risky file and avoids a second multi-minute service boot in every PR.
6. **9.5 as a board dependency.** `9.7`'s `deps` on the board include `9.5` (skill screens), which
   the stated flow never exercises. **Recommend** the lead drops `9.5` from `9.7`'s `deps` (a board
   edit, not a code change) so 9.7 is not blocked on an unrelated task; if the lead instead wants
   9.7 to also cover a skill screen, that is new scope needing its own open question.

## Budget
Budget: 150 tool calls (2 phases, apps/web + .github)

Phase A: 100 (new spec, two fixtures edits, global-setup edit, CI workflow edit, local Playwright
run against docker compose postgres, plus the full web `typecheck lint test`). Phase B: 50 (insert
two stages into an existing, working spec once 9.2c and 9.6 are mergeable; re-run locally).

## Allowed tools
Read, Grep, Glob, Edit, Write, and Bash for these uses only:
- `corepack pnpm --filter @edmate/web e2e` (and `playwright install --with-deps chromium` once);
- `docker compose … up -d postgres` for the local Postgres the suite needs;
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`;
- `python3 .githooks/secret-scan.py --all`;
- git on the phase's own branch (commit, `merge origin/main`, push; no rebase or force).
No new dependencies and no network installs beyond the Playwright browser binary (already a
`devDependency`; only its browser download is new, cached by the existing Playwright setup).

## Exit conditions
- **DONE (Phase A):** `full-flow.spec.ts` passes locally against a local compose Postgres covering
  every stage except discover and upgrade; the new CI steps are added to `ci.yml` and documented
  in the handoff as "added, not yet proven green in CI" unless the builder can trigger an Actions
  run from its branch (note either way); `corepack pnpm turbo run typecheck lint test
  --filter=@edmate/web...` is green; the secret scan is clean; the handoff has the `risk: high`
  decision for the `.github/workflows/ci.yml` edit and the two "Decisions" above.
- **DONE (Phase B):** the full spec (discover through teacher answer) passes locally and in CI;
  acceptance ("green in CI with scripted gateway") is pasted into the handoff with the CI run link
  or log excerpt.
- **PARTIAL (stop and hand off):** stop past about 90 tool calls (Phase A) or 45 (Phase B) with
  work left. Also stop when:
  - 9.2c's or 9.6's merged shape needs a selector, route or fixture this plan doesn't list (Phase
    B only — report what changed);
  - the CI job needs a second service (Redis-dependent real pipeline) to pass — re-open open
    question 3 instead of improvising;
  - two fix attempts on the same failing test fail.
- **BLOCKED:** a question above is answered in a way this plan does not cover, or 9.2c/9.6 merge
  with a shape that removes a page or route 9.7 depends on.

## Lead answers (22 Oct 2026)
- Q1: accepted. The e2e global setup verifies the demo teacher; seed.ts is unchanged. The throwaway staff role exists only in the e2e database.
- Q2: accepted. The student reloads to see the teacher's answer; live update is a non-blocking follow-up.
- Q3: accepted. Seed the uncovered question directly through teacherQuestions.open(); no Redis or worker in CI.
- Q4: accepted. No locale or market override for the webServer (9.4 precedent).
- Q5: accepted. Add the Playwright steps to the existing `node` job. The ci.yml edit is a risky path: security-reviewer reviews it.
- Q6: accepted. 9.5 is dropped from 9.7's deps; the flow does not use a skill screen.
- Build order: Phase A (board 9.7a) now, on Sonnet. Phase B (board 9.7b) after 9.2c and 9.6 (the upgrade route, 9.6b) merge.
