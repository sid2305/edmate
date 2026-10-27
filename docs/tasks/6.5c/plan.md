# Task 6.5c: move the evidence job onto `appendAndFold`, plus the 6.5a review MEDIUM/LOWs

Board: milestone M13 · deps `6.5a` (done) · **risky** (`packages/db/src/repositories/**`) ·
**one phase** (`apps/worker` + `packages/db`, no schema/migration).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "6.5a plan Q3: the worker's JOB.evidence processor (apps/worker/src/commit/processors.ts)
folds mastery in a second, unlocked transaction after evidenceEvents.append; move it onto
appendAndFold so the append and the fold share the profile-row lock, as 6.2 did for
profileStoreFor.applyEvidence; plus 6.5a review MEDIUM/LOWs: the processor reports an event
dropped by the reset watermark as already_written (tell a watermark drop apart from a replayed
duplicate, and fix the processors.ts comment); a debug log when learner.ts dropBeforeReset drops
events or sessions.end skips a stale summary"

Accept: "a concurrent test shows two evidence jobs for one learner fold both events; worker and db
gates green"

### How it is shown
`apps/worker/test/commit.int.test.ts` gets one new `it`, using the file's own existing pattern for
testing a real race (the `teacherQuestions.open` `Promise.all` pair already in this file, not the
queue): two *different* evidence events for one student x teacher, submitted to `commitProcessor`
via `Promise.all` (not sequentially through BullMQ, so both transactions genuinely overlap).
After both settle, `learnerProfiles.get` shows **both** events folded (mastery's `n` for the shared
topic increased by 2, not 1) — the lost-update this task's move to `appendAndFold` prevents.
`corepack pnpm turbo run typecheck lint test --filter=@edmate/worker... --filter=@edmate/db...`
is green with Postgres **and** Redis up.

## State of the world (read, not assumed)

- **`apps/worker/src/commit/processors.ts`'s `JOB.evidence` handler** (lines ~198-216) still does
  three separate transactions: `repos.evidenceEvents.append(...)`, then, only if something was
  written, `repos.learnerProfiles.get(...)` and `repos.learnerProfiles.applyMastery(...)`. This is
  the exact race 6.2 fixed for `profileStoreFor.applyEvidence` (`packages/db/src/repositories/
  ports.ts`) by introducing `evidenceEventsRepo.appendAndFold` — one transaction, one lock, read
  mastery and fold before releasing it. The worker path was built in task 3.17, before `
  appendAndFold` existed, and was flagged but deliberately left alone by 6.5a (plan Q3) with this
  task named as the follow-up (`docs/tasks/6.5a/plan.md`, `docs/tasks/6.5a/handoff.md`, `docs/
  tasks/6.5a/review.md` MEDIUM).
- **`evidenceEventsRepo.appendAndFold`** (`packages/db/src/repositories/learner.ts`) already does
  exactly what the worker needs in one call: locks the profile row (`FOR UPDATE`), reads `mastery`
  and `memoryResetAt` together, drops any event dated before the watermark (`dropBeforeReset`),
  inserts the survivors, folds them with `foldMastery`, and returns only the events it actually
  wrote (same idempotent, `ON CONFLICT (id) DO NOTHING` shape `append` already has). Swapping the
  worker onto it is a signature-compatible drop-in: both take `(scope, EvidenceEventEntry[])` and
  return `EvidenceEvent[]`.
- **The 6.5a review's MEDIUM** (`docs/tasks/6.5a/review.md`): an event dropped by the reset
  watermark and a replayed duplicate (`ON CONFLICT (id) DO NOTHING`) both make `applied` come back
  empty, and the processor's old comment ("evidenceEvents.append is itself idempotent... a replayed
  job's id already exists, applied comes back empty") only names the duplicate case, not the
  watermark one. `JobOutcome` (`'written' | 'already_written'`) is correct either way — no retry is
  needed for a watermark-dropped event, same as a true duplicate — so this task does not add a
  third outcome value (see Q2); it adds a debug log inside `packages/db` so the two cases are
  distinguishable *in logs*, and rewords the comment to name both.
- **No existing logging convention inside `packages/db`.** `packages/db` writes to the database
  (including an explicit `audit_log` table for real audit trails) but threads no `Log`/logger
  object into any repository factory — confirmed by grep across `packages/db/src/repositories/**`.
  Node builtins are already freely imported there (`sessions.ts` imports `randomUUID` from
  `node:crypto`; `packages/db/src/seed.ts` imports `isDeepStrictEqual` from `node:util`), so this
  task adds one more: `debuglog` from `node:util`, namespace `edmate:db` — a zero-cost no-op unless
  `NODE_DEBUG` includes it, no new dependency, no signature or return-type change on any method, no
  port or contracts change. See Q1 before building if the lead wants a different mechanism.
- **`apps/worker/src/commit/processors.test.ts`** (unit tests, in-memory fake repos) mocks
  `evidenceEvents.append` and `learnerProfiles.get`/`applyMastery` separately (lines ~110-142,
  ~336-359) — these fakes, and the two tests that key failures off `'evidenceEvents.append'`, must
  move to a single `appendAndFold` fake (dedupe-by-id into the in-memory list, then
  `foldMastery(profile.mastery, written)` from the real `@edmate/db` export, in one call) or the
  suite breaks the moment the processor stops calling `append`/`get`/`applyMastery` for evidence.
  This file is **not** in `risk-paths.txt` and is not a shared-builder file.
- **Not in bounds for a db test**: no new `packages/db` behavior is added beyond the two debug-log
  lines (same filtering/skip logic 6.5a already shipped and already-tested). `packages/db/test/
  memory-reset-watermark.int.test.ts` and `packages/db/test/sessions.int.test.ts` already exercise
  every branch the logs sit inside (`dropBeforeReset` dropping >0 events; `sessions.end` skipping a
  stale summary) — rerun them for regression, do not modify them. If a reviewer asks for a new
  assertion, prefer a new, narrow case in `memory-reset-watermark.int.test.ts` over touching
  `packages/db/test/repositories.int.test.ts`, which stays out of bounds here (see Files out of
  bounds — another builder owns changes to that file and to `chunks.ts`/`map.ts` right now).
- US-first, English only; no payments. No contracts change (same precedent 6.5/6.5a used).

## Design

1. **`apps/worker/src/commit/processors.ts`**, `JOB.evidence` handler: replace
   `append(...)` → conditional `get`/`applyMastery` with one call:
   `const applied = await repos.evidenceEvents.appendAndFold(d.scope, [{ ...d.event, id }]);`
   then `return applied.length > 0 ? 'written' : 'already_written';` inside the existing
   `try`/`catch (error) { return classify(job.name, error); }`. Remove the now-unused `foldMastery`
   import (it was only used by this handler) and the `learnerProfiles.get`/`applyMastery` calls.
   Reword the comment above the handler to name both reasons `applied` can come back empty
   (a replayed duplicate, or an event the reset watermark dropped — see `dropBeforeReset`'s debug
   log, `NODE_DEBUG=edmate:db`) and to say the fold now shares the profile-row lock with the write
   (no second, unlocked transaction).
2. **`packages/db/src/repositories/learner.ts`**: import `debuglog` from `node:util` once
   (`const debug = debuglog('edmate:db');`, module scope). In `append` and `appendAndFold`, right
   after computing `survivors` (both call sites already have `list.length` and `survivors.length`
   in scope), when `survivors.length < list.length`, call
   `debug('%s: reset watermark dropped %d of %d event(s) for %s/%s', method, list.length -
   survivors.length, list.length, sc.teacherId, sc.studentId);` — no event payload, no `ts`, no
   correctness text, counts and ids only (same restraint the file's existing comments use: no
   student-text logging precedent elsewhere in this file either).
3. **`packages/db/src/repositories/sessions.ts`**: same `debuglog('edmate:db')`, module scope.
   Inside `end`, right where `stale` is computed (after the existing `const stale = ...`), when
   `stale` is `true`, call `debug('sessions.end: skipped a stale summary for session %s (ended, but
   started before the reset watermark)', id);` before the `if (!stale)` branch that writes the
   profile only applies when summary is defined — place the log inside that same `if (summary !==
   undefined)` block so it only fires when there actually was a summary to suppress.
4. **`apps/worker/test/commit.int.test.ts`**: one new `it` (after the existing evidence test),
   using a second seeded student (`stu_test_02`, already seeded, unused elsewhere in this file, to
   avoid coupling to the earlier evidence test's mastery state) and the same seeded topic
   (`top_test_01`). Two distinct events (different `ts`, same topic, both `correct: true`) run
   through `commitProcessor(db.repos, (l) => lines.push(l))` via `Promise.all`. Assert both return
   `'written'` and `(await db.repos.learnerProfiles.get(scope2))?.mastery['top_test_01']?.n` is `2`
   (not `1`, which is what the old append-then-get-then-applyMastery shape could produce under a
   true race — a lost update). Because `appendAndFold`'s row lock makes the two transactions fully
   serialise, this assertion is deterministic after the fix (not flaky): whichever job's transaction
   commits first, the second's own locked read sees the already-folded mastery and folds on top of
   it, every run.
5. **`apps/worker/src/commit/processors.test.ts`**: replace the `evidenceEvents.append` +
   `learnerProfiles.get`/`applyMastery` fakes (lines ~110-142) with one `evidenceEvents.appendAndFold`
   fake: dedupe incoming events by id into the existing `evidence` array (same logic as today's
   `append` fake), then, for whatever list it actually wrote (`written`), when non-empty, set
   `profile.value = { ...profile.value, mastery: foldMastery(profile.value.mastery, written.map(e
   => ({ topicId: e.topicId, correct: e.correct, ts: e.ts }))) }` using the real `foldMastery`
   imported from `@edmate/db` (not re-implemented). Drop the `learnerProfiles` key from the mock
   object entirely (nothing else in `processors.ts` calls it for evidence, and no other job type in
   this file uses `learnerProfiles`). Rename the two tests' failure keys from
   `'evidenceEvents.append'` to `'evidenceEvents.appendAndFold'` (the object key passed to
   `memoryRepos({...})` and the label inside the injected `RepositoryError`) so the injected failure
   still fires on the renamed `check()` call.

No contracts change, no `packages/harness` change, no new migration, no `JobOutcome` change (Q2).

## Files

**Create:** none.

**Modify**
- `apps/worker/src/commit/processors.ts`: `JOB.evidence` handler onto `appendAndFold`; comment
  reword; drop the unused `foldMastery` import.
- `apps/worker/src/commit/processors.test.ts`: `memoryRepos`'s evidence fakes merged into one
  `appendAndFold` fake; two tests' failure keys renamed.
- `apps/worker/test/commit.int.test.ts`: one new concurrent-fold `it`.
- `packages/db/src/repositories/learner.ts`: `debuglog('edmate:db')` import; one log call each in
  `append` and `appendAndFold`, right after `survivors` is computed.
- `packages/db/src/repositories/sessions.ts`: `debuglog('edmate:db')` import; one log call in `end`
  where `stale` is computed.

## Files out of bounds
- `packages/contracts/**`, `docs/adr/**`: no contracts change. Stop and report if one seems needed.
- `packages/harness/**`: `ProfileStore`/`buildContext` are untouched; this task only changes which
  `packages/db` method the worker's own job handler calls.
- `apps/web/**`: not touched; `sessionsRepo.end` has no production caller yet (confirmed by grep —
  only `packages/harness`/`apps/web` *read* `repos.sessions`, none call `.end()` outside tests), so
  there is no app-layer call site to add a logger to instead of the `packages/db`-level debug log.
- `packages/db/src/repositories/chunks.ts`, `packages/db/src/repositories/map.ts`,
  `packages/db/src/repositories/README.md`: owned by other running builders (12.2f Phase C, 8.2i) —
  do not touch, even in passing.
- `packages/db/test/repositories.int.test.ts`: owned by 8.2i later; this task adds no new behavior
  that file's grid would need to cover (see State of the world). Do not touch.
- `packages/db/src/index.ts`, `packages/db/src/schema/**`, `packages/db/migrations/**`: no new
  export, column or migration needed.
- `JobOutcome` (`apps/worker/src/commit/processors.ts`'s type): stays two values (Q2).

## Tests first

Write/run these and see the expected state before any code:
1. Add the new `apps/worker/test/commit.int.test.ts` concurrent-fold case first, run it against
   **unmodified** `processors.ts` (still the old append-then-get-then-applyMastery shape). Record
   the result in the handoff either way — a genuine race is not guaranteed to lose an update on
   every single run, so a pass here is not proof of correctness and a fail is not required to
   proceed; it's read for information, not gated on.
2. Make the `processors.ts` change (step 1 of Design). Re-run the new test **three times in a row**
   to rule out flakiness (the row lock makes it deterministic once `appendAndFold` is in place —
   three straight passes confirms no coincidence).
3. Update `processors.test.ts`'s mock (step 5 of Design) *before* or *alongside* the `processors.ts`
   change — the existing suite will fail to resolve the evidence tests the moment `append`/
   `get`/`applyMastery` stop being called, so this is naturally red-then-green too.
4. Re-run (don't assume green) `packages/db/test/memory-reset-watermark.int.test.ts` and
   `packages/db/test/sessions.int.test.ts` after adding the two debug-log lines, to confirm the
   `debuglog` no-op (default, `NODE_DEBUG` unset) changes no behavior.
5. Re-run `apps/worker/test/commit.int.test.ts` in full (not just the new case) and
   `apps/worker/src/commit/processors.test.ts` in full for regressions.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
--filter=@edmate/db...` with both services up:
`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f
apps/worker/test/compose.port.yaml up -d postgres redis`, then
`python3 .githooks/secret-scan.py --all`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/learner.ts`, `packages/db/src/repositories/sessions.ts` match
  `packages/db/src/repositories/**` → **security-reviewer** required.
- Not risky: `apps/worker/src/commit/**` (no glob matches it; only `apps/worker/src/alerts/**` is
  listed) and `apps/worker/test/**` / `packages/db/test/**` (no test glob is listed). code-reviewer
  and typescript-reviewer run as usual on every PR.
- **Recommended, beyond the gate:** database-reviewer (new log statements inside locked sections of
  `learner.ts`/`sessions.ts`, and the worker's lock-sharing change itself); silent-failure-hunter
  (this task exists to close their own 6.5a findings — worth a second look that the fix lands as
  intended).
- The handoff logs a `risk: high` decision (draft below) — same reasoning 6.5a used: new behavior
  (even log-only) inside `packages/db/src/repositories/**`, a risky path.

## Open questions (each with a recommendation; none blocks the start)

- **Q1. Is a fresh `node:util` `debuglog('edmate:db')` convention (no prior use in `packages/db`)
  the right fix for "a debug log when dropBeforeReset drops events or sessions.end skips a stale
  summary," or should this wait for a real logger port threaded through the repositories?**
  Recommend **`debuglog` now**: it is a Node builtin already imported elsewhere in this exact file
  family (`node:crypto` in `sessions.ts`, `node:util` in `seed.ts`), costs nothing when
  `NODE_DEBUG` is unset (the review's LOWs ask for *observability*, not a new required dependency),
  and needs no signature, port, or contracts change — the smallest fix that closes the finding.
  Threading a real logger through every repository factory is a much bigger, separable change if
  the lead wants persistent (not opt-in) logs later.
- **Q2. Should `JobOutcome` (`'written' | 'already_written'`) gain a third value so a watermark
  drop is distinguishable from a true duplicate without reading debug logs?** Recommend **no**:
  grep across `apps/worker/src` shows no caller reads `JobOutcome` for metrics or dead-letter
  routing today (only tests assert it, and BullMQ's own retry logic reacts to thrown errors, not
  the return value) — both cases correctly mean "no retry needed," so a third value would be a
  distinction with no consumer yet. The debug log (Q1) already makes the two tellable apart for
  anyone reading logs. Revisit if a future task adds job-outcome metrics.
- **Q3. Does the new concurrent test need to reliably demonstrate the *old* code losing an update
  (a true red step), or is it enough that it deterministically passes after the fix?** Recommend
  **the latter**: races are inherently non-deterministic to provoke on demand without fault
  injection into production code (which this task must not add just for a test). The acceptance
  text itself ("a concurrent test shows two evidence jobs... fold both events") only requires the
  post-fix behavior to be shown and green; record the pre-fix run's result in the handoff for
  information, don't gate on it being red.

Deferred (say so in the handoff, not fixed here): threading a real logger through `packages/db`
(Q1's bigger alternative); a `JobOutcome` taxonomy expansion (Q2's bigger alternative); exposing
`memory_reset_at` anywhere student-facing (no ask for it, unchanged from 6.5a).

## Decisions (draft for the handoff)

### 6.5c moves the worker's evidence job onto `appendAndFold` · risk: high
Decided: `apps/worker/src/commit/processors.ts`'s `JOB.evidence` handler now calls
`repos.evidenceEvents.appendAndFold` instead of `append` followed by a separate `learnerProfiles.
get`/`applyMastery` pair, closing the same class of lost-update race 6.2 fixed for
`profileStoreFor.applyEvidence` — the write and the fold now share one `FOR UPDATE` lock inside one
transaction. `packages/db/src/repositories/learner.ts` and `sessions.ts` each gain one
`node:util` `debuglog('edmate:db')` call (no behavior change, no signature change) so a reset
watermark drop is distinguishable, in logs, from a replayed duplicate, and so a stale-summary skip
in `sessions.end` is no longer silent.
Why: a job queued, retried or re-delivered twice for one learner must never lose one of two
genuinely distinct updates to that learner's mastery; `appendAndFold`'s lock already gives this
guarantee everywhere else it's used — the worker's own evidence path was the one place left on the
older, two-transaction shape.
risk: high (new locking/control-flow change inside `packages/db/src/repositories/**`, a risky
path, even though the two new log lines are themselves no-ops by default).

## Budget
Budget: 60 tool calls (1 phase, apps/worker + packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck, lint and test via corepack pnpm turbo; `docker
compose … up -d postgres redis` for the worker/db integration tests; `python3
.githooks/secret-scan.py --all`). No network, model or payment calls.

## Exit conditions
- **Status: DONE** when: the new concurrent-fold test in `apps/worker/test/commit.int.test.ts`
  passes three times in a row; `apps/worker/src/commit/processors.test.ts`'s full suite is green
  with the `appendAndFold` fake; `packages/db/test/memory-reset-watermark.int.test.ts` and
  `packages/db/test/sessions.int.test.ts` stay green with no regression; the full gate
  (`typecheck lint test --filter=@edmate/worker... --filter=@edmate/db...`) is green with Postgres
  and Redis both up; `git diff origin/main -- packages/contracts` is empty; and the handoff has the
  draft `risk: high` decision plus `Tool calls used:`.
- **Status: PARTIAL** past about 60 calls, or if a file outside this plan needs changes (in
  particular `packages/contracts`, `packages/harness`, `apps/web/**`, `chunks.ts`, `map.ts`,
  `README.md` or `repositories.int.test.ts`), or if the lead's answer to Q1-Q3 changes scope. Stop
  and report; don't widen the task.
- **Status: BLOCKED** if a contracts change turns out to be needed.

## Lead answers (27 Oct 2026)
- Q1: yes, use `node:util` `debuglog('edmate:db')`; no logger dependency in packages/db.
- Q2: no third `JobOutcome` value; the reworded comment plus the debug log are enough.
- Q3: agreed; the concurrent test must pass deterministically (run it 3 times and record the runs), and it need not reproduce the old lost update.
- Tests stay out of packages/db/test/repositories.int.test.ts (12.2f and 8.2i use it).
