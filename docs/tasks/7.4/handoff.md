# Task 7.4 handoff: quality gate, Phases A (gate library) and B (db read)

Status: PARTIAL

- Branch: `m7/7.4-quality-gate` (Phase A pushed from local `work-74`, Phase B from `work-74b`)
- Worktrees: Phase A `.claude/worktrees/agent-af82ddb99249b28f2`, Phase B `.claude/worktrees/agent-a21e8795a34aa58bf`
- Tool calls used: 80 (Phase A 45, Phase B 35)
- State after Phase B: the gate works in memory on the demo teacher, both acceptance criteria are
  proven in tests, and `teacherEvalCases.listForTeacher` gives 8.7 the teacher's own rows to feed
  `answerableFromTeacherEvalCases`. There is no CLI yet (Phase C, after 7.6).

## Phase B: `teacherEvalCases.listForTeacher` (`packages/db` only)

Evidence (a local pgvector 16 container; `TEST_DATABASE_URL` pointed at it, so no int test skipped for lack of a db):

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
```
@edmate/db:test:  ✓ test/teacher-eval-cases.int.test.ts (4 tests)
@edmate/db:test:  Test Files  54 passed (54)
@edmate/db:test:       Tests  910 passed | 4 skipped (914)
@edmate/db:test: All files          |    99.9 |    97.73 |   99.81 |   99.94 |
 Tasks:    26 successful, 26 total
```
Isolation grid (`repositories.int.test.ts`): `teacherEvalCases.listForTeacher  teacher read  cases=22 leaks=0`.
`python3 .githooks/secret-scan.py --all` → exit 0.

Changes:
- `packages/db/src/repositories/teacher-eval-cases.ts` (new): `teacherEvalCasesRepo(db).listForTeacher(scope)`,
  `TEACHER_EVAL_CASES_MAX = 10_000`, `TeacherEvalCaseRow` (`id, moduleId, question, answer, origin`).
  `teacherScope` is parsed before any SQL; a single Drizzle select (parameterised) filtered by
  `teacher_id = scope.teacherId`, ordered `created_at, id`, `limit MAX + 1`; an extra row throws
  `RepositoryError('invalid')`.
- `packages/db/src/repositories/index.ts`: registered under `guardAll('teacherEvalCases', …)`; exports
  `TEACHER_EVAL_CASES_MAX` and `TeacherEvalCaseRow`.
- `packages/db/src/repositories/README.md`: one paragraph under "Ask the teacher (task 5.10)".
- `packages/db/test/repositories.int.test.ts`: the `CASES` entry (actor-only read; owners from the
  `[T]` markers in question/answer and the module id's teacher letter; 20 random ids see nothing).
- `packages/db/test/teacher-eval-cases.int.test.ts` (new): empty list; own rows only and in
  `(created_at, id)` order with an id tie-break; row shape has no teacher or chunk id; teacher B never
  sees `[A]` and vice versa; malformed scopes (incl. a quote-injection string and an extra key) are
  `scope` with a message naming only method and kind; exactly 10 000 rows returned, 10 001 is `invalid`,
  and teacher A is unaffected.

Phase B deviations: none. The over-cap test inserts cap rows with one `generate_series` statement
(no test seam in src). `packages/evals` and `apps/cli` untouched.

## Acceptance evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`
```
@edmate/evals:test:  ✓ src/qualityGate.test.ts (17 tests)
@edmate/evals:test:  ✓ src/gateScope.test.ts (17 tests)
@edmate/evals:test:  ✓ src/gateAdapters.test.ts (4 tests)
@edmate/evals:test:  ✓ src/qualityGateDemo.test.ts (3 tests)
@edmate/evals:test:  Test Files  29 passed (29)
@edmate/evals:test:       Tests  1102 passed (1102)
@edmate/evals:test: All files       |   100 |  94.98 |   100 |   100
@edmate/evals:test:   gateAdapters.ts |   100 |   100 |   100 |   100
@edmate/evals:test:   gateScope.ts    |   100 | 87.23 |   100 |   100
@edmate/evals:test:   qualityGate.ts  |   100 | 94.44 |   100 |   100
 Tasks:    18 successful, 18 total
```
`python3 .githooks/secret-scan.py --all` → exit 0.

`qualityGateDemo.test.ts` runs a material-change gate on `content/demo-teacher` (106 accuracy and
49 locked per-agent cases) with scripted agents and a scripted judge:
- **Bad agent** (teaches locked modules, answers out-of-course questions, cites nothing): the gate fails
  (`agent:accuracy 0/106`, `agent:locked 0/49`), `publish` is never called, and all 155 failed ids are named.
- **Nearly good agent** (one leak, `gen-lock-demo-package-free-direct-qr-15`): `agent:locked 48/49 FAIL`, so it is
  blocked, and `failedCaseIds` is exactly that id.
- **Good agent**: both groups pass and `publish` is called exactly once.
- **Time proxy** (inline snapshot): 155 agent calls + 155 judge calls = 310; ceil(310/4) + 2 = 80
  critical-path calls; 80 × 8 s = **640 s < 900 s**.

## Changes (all in `packages/evals`)
- `src/gateScope.ts` (new): `CHANGE_KINDS`, `ChangeKind`, `GateScopeError`, `GATE_THRESHOLDS`,
  `groupOf`, `sampleStyleCases` (FNV-1a on `seed:id`, ties broken by id, first 30; throws if fewer than 30), `selectGateCases`.
- `src/qualityGate.ts` (new): `runQualityGate` (bounded pool, results in scope order, a deadline
  that fails closed, per-group verdicts, `empty_group`), `gatedPublish`, `gateStats`, `groupVerdict`,
  and the constants `GATE_CONCURRENCY = 4`, `ASSUMED_CALL_SECONDS = 8`, `GATE_DEADLINE_MS = 900000` and `DEADLINE_NOT_RUN`.
- `src/gateAdapters.ts` (new): `agentPackagesFromConfigs`, `answerableFromTeacherEvalCases`, plus a
  `TeacherEvalCaseLike` structural type.
- `src/runner.ts`: `runCaseSafely` is now exported. Its behaviour is unchanged.
- `src/index.ts`: the new exports.
- `src/demoSuiteInput.testkit.ts` (new): 7.3's demo adapter, moved out of `perAgentSuiteDemo.test.ts`,
  which now imports it. No assertion changed.
- `src/gate.testkit.ts` (new): scripted agent, marker-based scripted judge (`ScriptedGateway`).
- Tests: `gateScope.test.ts`, `qualityGate.test.ts`, `gateAdapters.test.ts`, `qualityGateDemo.test.ts`.
- `tsconfig.build.json` and `vitest.config.ts`: `src/**/*.testkit.ts` is excluded from the build and from coverage.

## Deviations
- The plan put the test helper at `packages/evals/test/demoSuiteInput.ts`. The evals tsconfig has
  `rootDir: src`, so a src test can't import from `test/` without failing `tsc`. The helpers are
  `src/*.testkit.ts` instead, and the build and coverage leave them out.
- `manualClock` from harness testing has only `sleep`, not `now`. The deadline tests use a local counter
  that the scripted agent advances, which is the same idea and uses no real timer.
- The per-agent `locked` group is expected (so it fails with `empty_group` when it has no cases) only when some package
  leaves out a course module. See Decisions.

## Left to do
- **Phase B**: done (above). Risky path `packages/db/src/repositories/**`: needs security-reviewer
  and code-reviewer in `review.md`.
- **Phase C** (`apps/cli`, after 7.6): `edmate gate demo --change <kind>`, which runs in replay mode
  and exits 1 on failure.
- Open question for the lead (needed before a real `first_publish` gate can pass, so it blocks Phase C):
  today's `evals/suites` has **`feedback` (32) and `revision` (10)** cases, and neither suite has a
  threshold, so a full-scope gate over the real suites throws `GateScopeError` (no default threshold, by design).
  It also has **no platform `accuracy` cases**, so the full scope's `platform:accuracy` group fails `empty_group`.
  Which thresholds should feedback and revision get? And is platform accuracy covered by the per-agent accuracy cases?

## Decisions

### Pedagogy and grounding thresholds are provisional pass-rate proxies
- Decided: pedagogy passes at a pass rate of 80% or more until the runner can score a 1-5 mean. Grounding is held to 99% and runs only on a first publish or a prompt-pack bump. Lead's Q2 answer, 21 Oct 2026; 7.2 or 7.6 revisits it once scored runs exist.
- Why: the runner scores pass/fail, not a mean, and the build plan's table has no grounding row.
- risk: medium

### The "< 15 minutes" proof is a simulated critical path, backed by a deadline that fails closed
- Decided: estimatedSeconds = (ceil(total calls / 4) + the most calls in one case) × 8 s, with one call per turn and one per judge statement. At run time, a 15-minute deadline stops new cases from starting, marks every unstarted case `not run: gate deadline passed`, and fails the gate even when the thresholds would tolerate the misses. The 8 s and 4-way constants are provisional until 7.6 and 7.7 measure real p95 (lead Q6).
- Why: wall clock means nothing under a scripted gateway, and lessons.md says never to gate CI on timings.
- risk: medium

### gatedPublish is the only publish path offered
- Decided: `gatedPublish` calls publish only when `gate.pass === true` (a truthy non-boolean does not count), and a gate that throws never publishes. 8.7 must publish through it.
- Why: "Blocks publish on failure" has to hold structurally, not by convention.
- risk: medium

### Empty, unknown or duplicate inputs fail closed
- Decided: an expected group with zero cases fails as `empty_group`. An unknown suite, an unknown change kind, an empty change set, a duplicate case id or a style pool under 30 throws `GateScopeError`. A case that throws counts as failed.
- Why: a check that silently skips looks like a pass (lessons.md).
- risk: low

### The per-agent locked group is required only when some package locks a module
- Decided: the gate expects a non-empty `agent:locked` group only if some package leaves out a module that the teacher's material covers. With such a module, 7.3's generator always makes at least three locked cases.
- Why: a teacher whose packages all cover every module has nothing to lock. Requiring the group anyway would block every publish for that teacher with `empty_group`.
- risk: medium

### Near-miss distress cases count in the 100% distress group
- Decided: every `safety` case whose id starts with `safety-distress-` goes into `safety-distress` (100%). That includes the 9 `safety-distress-nearmiss-*` cases, following the plan's prefix rule literally.
- Why: it is the stricter reading. If the lead wants near-misses held to the 99% safety rate instead, it is a one-line change.
- risk: low

### A material change runs per-agent locked cases only
- Decided: a material change does not run the platform locked suite; that suite runs only on a first publish or a prompt-pack bump (lead's Q1 answer).
- Why: the platform locked cases are written against the demo teacher's modules.
- risk: low

### 7.4 teacherEvalCases.listForTeacher (repositories, risky path)
- Decided: a new read-only repository method returns only the scope's own `teacher_eval_cases` rows (`id, moduleId, question, answer, origin`), filtered by `teacher_id` with parameterised Drizzle SQL after `teacherScope` validation, ordered `created_at, id`, wrapped by `guardAll`, and covered by the isolation grid plus its own int test.
- Why: 8.7 needs the teacher's answers and corrections as per-agent accuracy cases for the gate (7.3 Lead answer Q3); the method is in `packages/db/src/repositories/**`, a risky path.
- risk: high

### Over 10 000 teacher eval cases throws instead of truncating
- Decided: `TEACHER_EVAL_CASES_MAX = 10_000`; the query fetches one extra row and throws `RepositoryError('invalid')` if it exists. No paging and no `truncated` flag.
- Why: the gate must never run a silently cut suite (lessons.md: a check that skips looks like a pass); a teacher near the cap needs a later board task for sampling or paging, not a quiet partial read.
- risk: medium

### The row shape leaves out teacher id, chunk id and question id
- Decided: `TeacherEvalCaseRow` carries only what `answerableFromTeacherEvalCases` needs; `teacherId`, `chunkId`, `teacherQuestionId` and timestamps stay in the db.
- Why: least data out of the repository; the scope already names the teacher.
- risk: low
