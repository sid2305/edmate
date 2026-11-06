# 7.5 — CI merge gates on fixtures

## Acceptance (verbatim)
"CI merge gates on fixtures. Accept: a deliberately leaky prompt pack fails CI."

## How this is shown
A new CI job (`gate-fixtures` in `.github/workflows/ci.yml`) builds `@edmate/cli` and runs the
real, already-shipped `edmate gate demo --change packages` command twice, fully offline (replay
only, no live model/judge call anywhere in this job — CLAUDE.md rule 4):

1. Against `evals/fixtures/demo-good` (a committed, pre-recorded fixture set for the demo
   teacher's real per-agent `locked` cases): must **pass** (exit 0).
2. Against `evals/fixtures/demo-leaky` (the same tree, except one case's recorded agent reply and
   judge verdict are swapped for ones representing a leaked locked module — "a deliberately leaky
   prompt pack"): must **fail** (exit 1), and the failure must be exactly that one case, not a
   different or wider breakage.

Both outcomes are checked by a small script (`.github/scripts/check_gate_fixture_reports.py`), not
eyeballed: it reads both `--report` JSON files and the leaky command's own captured exit code, and
fails the job itself if the good run doesn't pass, if the leaky run doesn't fail (by exit code *and*
by its `pass` field, so a silent "exit 0 but pass:false" bug is also caught), or if
`failedCaseIds` isn't exactly `[DEMO_LEAK_CASE_ID]`. This script has its own unit tests
(`.claude/tests/test_check_gate_fixture_reports.py`), and the workflow's shape (the new job exists,
is gated the same way `node`/`e2e` are, and runs both commands) is asserted in
`.claude/tests/test_workflows.py`, the same pattern that file already uses for the `changes`/`node`
gating (so a change to this wiring is a test failure, not a silent regression — lessons.md: "red
CI from changes that passed locally").

## Why `--change packages`, not a bigger scope
- `first_publish`/`prompt_pack_bump` (full scope) still fails closed today on blocker B-40
  (`evals/suites/feedback`/`revision` have no decided threshold, `evals/suites/accuracy` has no
  cases yet — confirmed in `docs/tasks/7.4/handoff.md` "Left to do"). That's correct behaviour,
  untouched by this task, not something to route around.
- `--change packages` runs only the per-agent `locked` group (`selectGateCases` in
  `packages/evals/src/gateScope.ts`: `agentLocked = agentAccuracy || changes.has('packages')`,
  `agentAccuracy` stays false). `locked` is the 100%-threshold group that exists precisely to catch
  "locked means locked" — the most on-topic group for "a deliberately leaky prompt pack" — and it
  needs no platform-suite fixtures and no `accuracy`/`feedback`/`revision` thresholds at all.
- Every locked case is single-turn with exactly one judge statement
  (`packages/evals/src/perAgentSuite.ts`'s `oneTurn`/`LOCKED_JUDGE`), so each case needs exactly two
  fixture files (`<id>/turn-0/agent.json`, `<id>/turn-0/judge-0.json`) — the smallest real, already-
  wired slice of the gate this task could exercise.

## Fixture-recording approach: (a), committed, scripted, no live call
`evals/fixtures/` is otherwise empty (lead's note). Per CLAUDE.md rule 4 ("no real model or
payment calls in tests") a CI step can never *record* against a live model, and the existing
`--record` path (`apps/cli/src/commands/eval.ts`) is explicitly live-only. So this task does **not**
add a recording step to CI. Instead (option a): a small, reviewable TypeScript generator
(`packages/evals/src/demoLockedFixtures.ts`) builds the exact fixture content for every real,
current per-agent `locked` case — using the same `adaptDemoTeacherContent(loadDemoTeacherContent(...))`
+ `generatePerAgentSuite` pipeline `apps/cli/src/commands/gate/demoInput.ts` already uses, so the
case ids match exactly what `edmate gate demo` will load — and a gated test
(`packages/evals/src/demoLockedFixtures.write.test.ts`) writes it to disk once, via the existing
`fileRecorder(dir, 'record')` (`packages/evals/src/recorder.ts`), the project's one recording
mechanism. The resulting JSON files are then committed, exactly like any other fixture. No new
recording path, no network, no model: for the "good" variant, a scripted refusal reply per package
(satisfying `must_cite_source:false` and, when `pkg.lockedReply === 'name_package'`,
`must_contain:[pkg.name]`) and a scripted `pass:true` verdict; for the one designated leak case, a
reply that actually states the locked module's content and a `pass:false` verdict (the LOCKED_JUDGE
rubric read literally: "does not teach... and gives the locked-package reply instead" — false here
on both counts).

## Files to create
- `packages/evals/src/demoLockedFixtures.ts` — pure: `demoLockedFixtureEntries(perAgent, opts?: {
  leakCaseId?: string }): { key: string; value: unknown }[]`, built from `generatePerAgentSuite`'s
  `locked` cases; `DEMO_LEAK_CASE_ID` (see below); the scripted refusal/leak text and verdict
  builders. Not exported from `index.ts` (an internal generation helper, not part of the package's
  public surface — same footing as the `.testkit.ts` files).
- `packages/evals/src/demoLockedFixtures.test.ts` — unit tests (TDD, written first): every "good"
  entry parses against `EvalAgentReplySchema` / `RecordedJudgeSchema`; `must_contain`/
  `must_cite_source` satisfied per package's `lockedReply`; with `leakCaseId` set, exactly that
  case's two entries differ and its judge verdict is `pass:false`, every other entry is unchanged
  from the no-`leakCaseId` run; keys match the `fileRecorder` key pattern (lowercase, `/`-joined).
- `packages/evals/src/demoLockedFixtures.write.test.ts` — two parts:
  1. **Always runs** (freshness guard, part of the normal `test` step the `node` CI job already
     runs): recomputes today's real locked-case id set from `content/demo-teacher` and asserts it
     is exactly the file set under `evals/fixtures/demo-good` and `evals/fixtures/demo-leaky`
     (so a content change that isn't followed by regenerating fixtures fails CI here, loudly, per
     lessons.md "a check that silently skips looks like a pass" — not a `MissingFixtureError` three
     steps later in a different job); and that `DEMO_LEAK_CASE_ID` is still among today's real
     locked case ids.
  2. **Gated write path**, `describe.skipIf(process.env.WRITE_DEMO_FIXTURES !== '1')`: regenerates
     both fixture directories via `fileRecorder(dir, 'record')`. Never runs in CI (no step sets
     that env var); it's how the builder (and anyone touching `content/demo-teacher` later)
     regenerates the committed files. Documented at the top of the file.
- `evals/fixtures/demo-good/**` and `evals/fixtures/demo-leaky/**` — generated output, committed.
  All-synthetic, no real student/teacher data (CLAUDE.md rule 5).
- `.github/scripts/check_gate_fixture_reports.py` — `--good <file> --leaky <file>
  --leaky-exit-code <n> --leak-case-id <id>`; exits 0 only when the good report's `pass` is `true`,
  the leaky exit code is non-zero *and* the leaky report's `pass` is `false` *and*
  `failedCaseIds == [leak-case-id]` exactly; else a clear stderr message naming which condition
  failed, exit 1.
- `.claude/tests/test_check_gate_fixture_reports.py` — unit tests for the script above (good/leaky
  pairs that should pass; a leaky report that unexpectedly passes; a leaky exit code of 0; a leaky
  report that fails on the wrong case id or on more than one case) — written before the script.

## Files to modify
- `.github/workflows/ci.yml` — new job `gate-fixtures`: `needs: changes`,
  `if: needs.changes.outputs.docs_only != 'true'` (same gating `node`/`e2e` already use), no
  services (this never touches Postgres/Redis). Steps: checkout, setup-node, `pnpm install
  --frozen-lockfile`, `corepack pnpm turbo run build --filter=@edmate/cli...`, run the good gate
  (plain, must exit 0 or the step fails the job directly), run the leaky gate with `set +e` and
  capture its exit code to a step output, then run `check_gate_fixture_reports.py` with both
  report paths, the captured exit code and the literal `DEMO_LEAK_CASE_ID`.
- `.claude/tests/test_workflows.py` — written first (red), then satisfied: asserts the `gate-fixtures`
  job exists, is gated by `needs.changes.outputs.docs_only` the same way `node` is (reusing this
  file's existing `eval_gh_if` helper), and its steps' `run:` text contains both `edmate gate demo`
  invocations (one against `evals/fixtures/demo-good`, one against `evals/fixtures/demo-leaky`) and
  the call to `check_gate_fixture_reports.py`.

## Files out of bounds
- `packages/harness/**`, `packages/contracts/**`, `packages/payments/**`, `apps/web/**` — untouched.
- `content/demo-teacher/**` — read only, never edited (fixtures must match it, not the other way
  round).
- `packages/evals/src/gateScope.ts` (`GATE_THRESHOLDS`) — no threshold changes; blocker B-40 stays
  open and out of scope.
- `.github/workflows/merge-gate.yml` — unrelated to this task.
- `evals/suites/**` — not touched; this task deliberately avoids the platform suite (see above).

## DEMO_LEAK_CASE_ID
7.4's own demo-agent test already names a real, current locked case id used the same way (the
"nearly good agent" leaks exactly `gen-lock-demo-package-free-direct-qr-15`,
`docs/tasks/7.4/handoff.md`). Phase A's first step is to confirm via
`demoLockedFixtures.test.ts`/the freshness test that this id is still present among today's real
generated locked cases (content may have changed since 7.4's commit); if not, use the current
lexicographically-first `locked` case id instead and say so in the handoff. Either way the id is a
literal, evidence-backed constant, not invented.

## Tests first (TDD order)
1. `packages/evals/src/demoLockedFixtures.test.ts` (red) → `demoLockedFixtures.ts` (green).
2. `demoLockedFixtures.write.test.ts`'s freshness half (red: no fixtures on disk yet) →
   `WRITE_DEMO_FIXTURES=1 corepack pnpm --filter @edmate/evals exec vitest run
   src/demoLockedFixtures.write.test.ts` to generate and commit the two fixture trees → rerun
   normally (green).
3. `.claude/tests/test_check_gate_fixture_reports.py` (red) → `check_gate_fixture_reports.py`
   (green).
4. `.claude/tests/test_workflows.py`'s new assertions (red) → `ci.yml`'s new job (green).

## Verification (mutation-style, not just eyeballed)
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` green.
- `corepack pnpm turbo run build --filter=@edmate/cli...`, then locally:
  `node apps/cli/bin/edmate gate demo --change packages --fixtures evals/fixtures/demo-good
  --report /tmp/good.json` → exit 0;
  `node apps/cli/bin/edmate gate demo --change packages --fixtures evals/fixtures/demo-leaky
  --report /tmp/leaky.json` → exit 1, `failedCaseIds` exactly `[DEMO_LEAK_CASE_ID]`.
- Mutation check (prove the checks aren't vacuous, then revert): flip `demo-good`'s
  `DEMO_LEAK_CASE_ID` judge fixture to `pass:false` → the "good" command must now fail. Flip
  `demo-leaky`'s same fixture back to `pass:true` → the leaky command must now pass, and
  `check_gate_fixture_reports.py` must now report the "gate unexpectedly passed" error (proving the
  checker, not just the gate, actually checks something).
- `python3 -m unittest discover -v .claude/tests` green (new + existing).
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` parses cleanly
  (lessons.md: a workflow file GitHub can't parse breaks CI silently until someone notices).
- `python3 .githooks/secret-scan.py --all` clean (fixtures are synthetic text only).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `.github/**` (new script, edited `ci.yml`) → reviewers: security-reviewer.
- `.claude/**` (new + edited test files) → reviewers: security-reviewer.
- Nothing under `packages/harness/src/guardrails/**`, `access/**`, `payments/**`, `contracts/**`,
  or any other listed group.
- This is a risky task: the handoff logs a `risk: high` decision for the `.github`/`.claude` merge,
  reviewed by security-reviewer, plus the usual typescript-reviewer and code-reviewer for the
  TypeScript/Python changes.

## Open questions
None blocking. `DEMO_LEAK_CASE_ID`'s exact literal is confirmed empirically in Phase A (see above)
rather than guessed here; that is evidence-gathering, not an open decision.

## Phase A — fixture generator + committed fixtures (`packages/evals` only)
Files: `demoLockedFixtures.ts`, `demoLockedFixtures.test.ts`, `demoLockedFixtures.write.test.ts`,
`evals/fixtures/demo-good/**`, `evals/fixtures/demo-leaky/**`.
Green: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`; the local
`edmate gate demo` dry run above (build `@edmate/cli` first) passes/fails as expected.
State after Phase A: both fixture trees exist, committed, and are proven correct locally; CI is not
yet wired.

## Phase B — CI wiring (`.github`, `.claude` only)
Files: `.github/workflows/ci.yml`, `.github/scripts/check_gate_fixture_reports.py`,
`.claude/tests/test_check_gate_fixture_reports.py`, `.claude/tests/test_workflows.py`.
Green: `python3 -m unittest discover -v .claude/tests`; the YAML-parses check; the mutation checks
above re-run against Phase A's fixtures through the new job's exact commands.

## Budget
Budget: 150 tool calls (2 phases: Phase A ~80, Phase B ~70; packages @edmate/evals, .github/.claude)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm/turbo typecheck/lint/test/build, vitest fixture
generation, python unittest, YAML parse check, secret scan — no network, no live model/payment
call).

## Exit conditions
Status: DONE when both phases are green per their verification steps above, both fixture trees are
committed, and the local dry run of the exact CI commands (good passes, leaky fails on exactly
`DEMO_LEAK_CASE_ID`, the python checker agrees) succeeds — this is the proof the real GitHub
Actions run isn't directly observable to the builder but reproduces exactly. Status: PARTIAL past
roughly 150 tool calls total, or if `content/demo-teacher`'s real locked-case set turns out to have
changed enough that no stable single-case id can be chosen confidently (escalate to the lead rather
than guess), or if a file outside this plan's list needs changing.
