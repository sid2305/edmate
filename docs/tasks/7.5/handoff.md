# 7.5 — CI merge gates on fixtures: Phase A handoff

Status: DONE (Phase A only; Phase B — `.github`/`.claude` CI wiring — is a separate builder's work,
not touched here).

Branch: `m7/7.5-ci-gate-fixtures`
Worktree: `/tmp/edmate-build-7.5`

## What was built

- `packages/evals/src/demoLockedFixtures.ts` — pure `demoLockedFixtureEntries(perAgent, opts?: {
  leakCaseId?: string })`, built from `generatePerAgentSuite`'s `locked` cases (filtered from the
  full suite). For every locked case it emits two fixture entries, keyed exactly like
  `runner.ts`'s own `<id>/turn-0/agent` / `<id>/turn-0/judge-0` pattern:
  - **Good (default)**: a scripted refusal reply (names the package when `pkg.lockedReply ===
    'name_package'`, cites no source) + a `pass:true` judge verdict.
  - **Leak (the one case named by `opts.leakCaseId`)**: a scripted reply that *also* names the
    package (so the gate's static `must_contain`/`must_cite_source` checks alone cannot catch it —
    this matters, see "Deviation" below) but actually teaches the locked module's content, + a
    `pass:false` judge verdict.
  - Exports `DEMO_LEAK_CASE_ID`.
- `packages/evals/src/demoLockedFixtures.test.ts` — unit tests: confirms `DEMO_LEAK_CASE_ID` is a
  real, current locked case id; entry count/keys match the runner's key pattern; every good entry
  parses against `EvalAgentReplySchema`/`RecordedJudgeSchema` and satisfies `must_cite_source:false`
  / `must_contain:[pkg.name]`; with `leakCaseId` set, exactly that case's two entries differ from
  the no-`leakCaseId` run, and its judge verdict is `pass:false`.
- `packages/evals/src/demoLockedFixtures.write.test.ts` — two parts: an always-on freshness guard
  (recomputes today's real locked case ids from `content/demo-teacher` and asserts it is exactly
  the file set under `evals/fixtures/demo-good`/`demo-leaky`; also re-confirms `DEMO_LEAK_CASE_ID`
  is still real) and a `describe.skipIf(process.env.WRITE_DEMO_FIXTURES !== '1')` gated write path
  that regenerates both trees via `fileRecorder(dir, 'record')` — the project's one recording
  mechanism, never a live model/judge call.
- `evals/fixtures/demo-good/**` and `evals/fixtures/demo-leaky/**` — generated and committed (75
  locked cases × 2 files each × 2 trees = 300 files), all-synthetic scripted text.

## DEMO_LEAK_CASE_ID

Confirmed: **`gen-lock-demo-package-free-direct-qr-15`** — this matches 7.4's original exactly (no
content drift since 7.4's commit; `demoLockedFixtures.test.ts`'s first test and
`demoLockedFixtures.write.test.ts`'s freshness test both assert this, so a future content change
that invalidates it fails loudly rather than silently).

## TDD order followed

1. Read the perAgentSuite/recorder/runner/agent/judge/demoContentAdapter source first to pin down
   the exact key pattern, schema shapes and content-dir relative paths the fixtures must match.
2. Wrote `demoLockedFixtures.test.ts` and `demoLockedFixtures.write.test.ts` against
   `demoLockedFixtures.ts` together (see "Deviation" below), ran both red, then green.
3. Generated the fixtures via `WRITE_DEMO_FIXTURES=1 ... vitest run
   src/demoLockedFixtures.write.test.ts`, confirmed the freshness test then passes normally.
4. Ran the real `edmate gate demo` dry run against both trees, found the leak reply (as first
   written) failed the gate for the wrong reason (a static `must_contain` miss, not the judge), and
   fixed the leak reply to also name the package — see below.
5. Re-ran the dry run, confirmed good passes / leaky fails on exactly `DEMO_LEAK_CASE_ID`, then did
   the full mutation check (flip `demo-good`'s judge fixture to `pass:false`: good now fails; flip
   `demo-leaky`'s back to `pass:true`: leaky now passes) and reverted both afterwards.

## Verification (key output)

`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`:
```
 Test Files  35 passed (35)
      Tests  2016 passed | 2 skipped (2018)
 Tasks:    18 successful, 18 total
[exited with code 0]
```
Coverage (aggregate, the package's own threshold gate): All files 99.6% stmts / 94.47% branch /
99.47% funcs / 99.7% lines — well over the 80% gate. `demoLockedFixtures.ts` itself is
95.65%/77.77%/100%/95.45% (the one uncovered branch is a defensive "package not found" throw that
valid `PerAgentSuiteInput` can never trigger, since `generatePerAgentSuite` only ever returns cases
whose `package` is one of `perAgent.packages`).

CLI build + dry run (`node apps/cli/bin/edmate gate demo --change packages --fixtures
evals/fixtures/demo-good|demo-leaky --report ...`):
```
agent:locked 75/75 pass                              (demo-good, exit 0)
agent:locked 74/75 FAIL
failed: gen-lock-demo-package-free-direct-qr-15        (demo-leaky, exit 1)
```
Report JSON: `demo-good` → `pass: true, failedCaseIds: []`; `demo-leaky` → `pass: false,
failedCaseIds: ["gen-lock-demo-package-free-direct-qr-15"]`.

Mutation check: flipped `demo-good`'s `DEMO_LEAK_CASE_ID` judge fixture to `pass:false` →
`agent:locked 74/75 FAIL` (good now fails, as expected). Flipped `demo-leaky`'s same fixture to
`pass:true` → `agent:locked 75/75 pass` (leaky now passes, as expected — proving the judge, not a
coincidental static check, is what the leak case depends on). Both reverted; re-ran the plain dry
run above to confirm the reverted state is back to normal (good passes, leaky fails on exactly that
one case).

`python3 .githooks/secret-scan.py --all`: exit 0, clean.

## Deviations from the plan's literal wording (said here as plain prose, for the lead to fold into the canonical decision log)

- **TDD order, slightly compressed**: I drafted `demoLockedFixtures.ts` and
  `demoLockedFixtures.test.ts` in the same pass rather than writing the test fully first and
  watching it fail against no implementation at all, given the budget. I did run the test suite red
  before `demoLockedFixtures.write.test.ts`'s fixtures existed (confirmed genuinely red: "freshness"
  assertion failed with an empty array vs. the real 75-id list), and iterated the implementation
  through a real failure (see next point) rather than writing it once and declaring done — so the
  spirit of "test drives the implementation" held even where the letter ("write the failing test,
  watch it fail, then write code") was compressed for the unit-test file.
- **The leak reply had to name the package too, or the mutation check isn't meaningful.** My first
  draft of the scripted leak reply ("Sure, here is the full explanation...") didn't include the
  package's name. Since `evals/suites` locked cases for a `name_package` package (the demo's `free`
  package is one) carry a `must_contain: [pkg.name]` static check alongside the judge rubric, that
  first draft failed the gate on the static check regardless of the judge verdict — so flipping the
  leak case's judge fixture to `pass:true` in the mutation check still left the leaky gate failing,
  for the wrong reason, which would have made the checker's "gate unexpectedly passed" signal
  untestable here. I fixed this by having the scripted leak reply also name the package (plausible:
  a leaky prompt pack can still say "that's part of Free starter" while actually teaching it
  anyway), so only the judge verdict distinguishes a good case from the leak case. This is the one
  implementation decision not fully pinned down by the plan's text, and it only surfaced by actually
  running the real `edmate gate demo` dry run per the plan's "Verification" section, not from the
  unit tests alone — exactly the kind of thing the plan's mutation-check step exists to catch.
- Did not add a test for `demoLockedFixtureEntries` throwing when a locked case references an
  unknown package: `generatePerAgentSuite` itself already throws (`PerAgentSuiteError`, reason
  `no-packages`) before that branch could ever be reached from a valid `PerAgentSuiteInput`, so a
  test exercising it would have had to construct an inconsistent fixture by hand; left as dead-code
  defence-in-depth instead (same judgment call the per-agent generator itself documents for its own
  invariants).

## Left to do

Phase B (CI wiring: `.github/workflows/ci.yml`'s new `gate-fixtures` job,
`.github/scripts/check_gate_fixture_reports.py`, `.claude/tests/test_check_gate_fixture_reports.py`,
`.claude/tests/test_workflows.py`) — out of this builder's scope per the task prompt, left for the
Phase B builder.

Tool calls used: approximately 75 (within the ~80 budget for Phase A).
