# Task 7.4 handoff: quality gate (Phases A, B, C)

Status: DONE

- Branch: `m7/7.4-quality-gate` (Phase A pushed from local `work-74`, Phase B from `work-74b`,
  Phase C from `work-74c`)
- Worktrees: Phase A `.claude/worktrees/agent-af82ddb99249b28f2`, Phase B
  `.claude/worktrees/agent-a21e8795a34aa58bf`, Phase C `.claude/worktrees/agent-ac11128b087ed888e`
- Tool calls used: 125 (Phase A 45, Phase B 35, Phase C 45)
- State after Phase C: `edmate gate demo --change <kind>` gives CLI parity for the quality gate,
  fully offline (replay fixtures only, no `--record`, no live model call). Phases A and B are
  unchanged below.

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

## Phase C: `edmate gate demo --change <kind>` (`apps/cli` only)

`edmate gate demo --change <kind> [--change <kind>...] [--fixtures <dir>] [--seed <s>] [--report
<file>]`: CLI parity for `runQualityGate`, fully offline. The command always builds its recorder
in `'replay'` mode (there is no `--record` flag here at all, so it is impossible to pass through);
a missing fixture fails its case (`MissingFixtureError`) and so the gate (`fail closed`). The
agent and judge gateway handed to `runQualityGate` are `unwiredAgent` / `replayJudgeGateway`
(both already in `eval.ts`) — in replay mode the recorder never calls either, since every reply
and verdict comes from its fixture, so this is provably no live call, not just an untested one.

Evidence: `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli... --filter=@edmate/evals...`
```
Tasks:    26 successful, 26 total
```
`apps/cli` coverage (`gate.ts` 100% stmts/funcs/lines, 83.33% branch; `gate/demoInput.ts` 100%
all four): `Statements 96% | Branches 86.16% | Functions 95.23% | Lines 97.16%` (whole package).
`python3 .githooks/secret-scan.py --all` → exit 0 (no output).

Changes:
- `apps/cli/src/commands/gate.ts` (new): arg parsing, the blocker-B-40 full-scope precheck
  (`fullScopeGaps`, below), wiring into `runQualityGate`, the per-group summary, `--report`.
- `apps/cli/src/commands/gate/demoInput.ts` (new): `loadDemoPerAgentInput`, a src copy of 7.3's
  test adapter (`demoSuiteInput.testkit.ts`) minus its two synthetic teacher-answer rows (the CLI
  has no `teacherEvalCases.listForTeacher` wiring yet; that is 8.7's job).
- `apps/cli/src/cli.ts` (edit): `gate` case and USAGE line.
- `apps/cli/src/commands/gate.test.ts` (new): argument errors (missing agent id, non-"demo" agent,
  missing/unknown `--change`, unknown flag, help); a style-card scope run end to end against a
  synthetic 30-case suite and hand-written fixtures (pass, one judge fixture failing, one fixture
  missing entirely — all exit 1 without any live call); `--report` writes the `GateResult` JSON;
  the blocker-B-40 precheck against the **real, public `evals/suites`** tree with `--change
  first_publish`, naming `feedback, revision` (no threshold) and `accuracy` (no platform cases).

### The blocker-B-40 precheck (`fullScopeGaps`)
A full-scope change (`first_publish` / `prompt_pack_bump`) over today's real `evals/suites` would
otherwise fail on the *first* `GateScopeError` `selectGateCases` happens to hit while iterating
cases (e.g. one `feedback` case's "no gate threshold" message) and never report the others. The
command instead walks every platform case once up front and reports, in one message:
`no gate threshold decided for suite(s): <list>` (suites not among `GATE_THRESHOLDS`' keys) and
`no platform cases yet for group(s): <list>` (threshold groups with zero matching cases, split by
the `safety-distress-` id prefix exactly as `gateScope.ts` does). Exit code 1 either way. This
never invents a threshold or widens scope to make something pass; it only says what the human
still needs to decide.

## Left to do
- **Phase B**: done (above). Risky path `packages/db/src/repositories/**`: needs security-reviewer
  and code-reviewer in `review.md`.
- **Phase C**: done (above).
- **Blocker B-40 still open for the lead**: `evals/suites/feedback` (32 cases) and
  `evals/suites/revision` (10 cases) have no gate threshold, and `evals/suites/accuracy` has no
  cases yet, so `edmate gate demo --change first_publish` (and `prompt_pack_bump`) exits 1 today
  by design, naming those three. Once the human decides feedback/revision's thresholds (and
  whether platform accuracy needs its own cases or is covered by per-agent accuracy), the fix is a
  `GATE_THRESHOLDS` edit in `packages/evals/src/gateScope.ts` — not a Phase C change.

## Decisions

### 21 Oct 2026 · 7.4 merge: scoped teacher eval-case read path reviewed and merged · decided by lead · risk: high
- Decided: merge 7.4, including `packages/db` `teacherEvalCases.listForTeacher` (a risky path), reviewed by security-reviewer and code-reviewer (the group's required reviewers) plus typescript-reviewer; all approved with no CRITICAL or HIGH. MEDIUM and LOW findings go to 7.4a; the undecided feedback and revision thresholds (blocker B-40) go to 7.4b, and until then a first_publish or prompt_pack_bump gate fails closed with a clear error.
- Why: the gate already blocks a bad agent and publishes a good one; the open thresholds only keep the full scope failing closed, which is the safe direction.
- risk: high

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

### The CLI gate never offers --record and routes replay through the already-reviewed stand-ins
- Decided: `edmate gate` has no `--record` flag at all (not just a default), so there is no path
  through its own arguments to a live call; it always builds `fileRecorder(dir, 'replay')`
  (or a test-injected `Recorder`) and hands `runQualityGate` the existing `unwiredAgent` /
  `replayJudgeGateway` from `eval.ts`. Replay mode never invokes either (the recorder returns the
  fixture without calling `fn`), so this is structurally offline, not just offline by convention.
- Why: the lead's Phase C note says the gate command must stay offline even though `edmate eval`'s
  default agent went live in 7.6; reusing `eval.ts`'s own stand-ins keeps that guarantee in one
  place instead of a second copy.
- risk: low

### A full-scope CLI run reports every undecided threshold/group at once, not just the first
- Decided: before calling `runQualityGate`, `edmate gate` walks `platformCases` once itself
  (`fullScopeGaps`) and, for a `first_publish`/`prompt_pack_bump` change, lists every suite with
  no gate threshold and every threshold group with zero platform cases in one error, exit 1. It
  never edits `GATE_THRESHOLDS` or narrows scope to dodge the gap.
- Why: `selectGateCases` throws on the first unknown-suite case it meets while building the full
  scope, which would have named only one of today's two gaps (`feedback` vs. `revision`) and said
  nothing about the empty `accuracy` group; blocker B-40 needs the whole picture to decide
  thresholds from, not a single symptom.
- risk: medium

### The demo content adapter drops the two synthetic teacher-answer rows for the CLI
- Decided: `apps/cli/src/commands/gate/demoInput.ts` copies 7.3's test adapter but leaves out its
  two synthetic `teacher_eval_cases`-shaped rows (`APPROVED_DRAFT_ROWS` in the evals testkit).
- Why: those rows exist only to exercise `generatePerAgentSuite`'s `teacher-answer` provenance in
  tests; the CLI has no real `teacherEvalCases.listForTeacher` wiring yet (8.7's job), and shipping
  synthetic rows that look like real teacher answers in production code risked being mistaken for
  real data later. Per-agent accuracy cases from `question-bank`/`qa-recall` are unaffected.
- risk: low

### Over 10 000 teacher eval cases throws instead of truncating
- Decided: `TEACHER_EVAL_CASES_MAX = 10_000`; the query fetches one extra row and throws `RepositoryError('invalid')` if it exists. No paging and no `truncated` flag.
- Why: the gate must never run a silently cut suite (lessons.md: a check that skips looks like a pass); a teacher near the cap needs a later board task for sampling or paging, not a quiet partial read.
- risk: medium

### The row shape leaves out teacher id, chunk id and question id
- Decided: `TeacherEvalCaseRow` carries only what `answerableFromTeacherEvalCases` needs; `teacherId`, `chunkId`, `teacherQuestionId` and timestamps stay in the db.
- Why: least data out of the repository; the scope already names the teacher.
- risk: low
