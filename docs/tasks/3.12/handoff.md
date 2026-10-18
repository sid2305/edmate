# 3.12 handoff: eval runner (YAML multi-turn cases, checks, judge scoring, record / replay)

Status: DONE
Branch: `m3/3.12-eval-runner`
Worktree: `.claude/worktrees/agent-a50accf36df05aa75`
Risky: no (checked against `.claude/skills/merge-gate/risk-paths.txt`: only `packages/evals/**`, `apps/cli/**`, `pnpm-lock.yaml`, `docs/tasks/3.12/**` touched).

## Acceptance evidence

Acceptance: "runs fully offline in CI on fixtures."

| Item | Evidence |
|---|---|
| YAML multi-turn cases load | `packages/evals/test/fixtures/suite/` holds 4 synthetic cases (single-turn, 3-turn pressure case with a no-`expect` middle turn, one with every check type, one in a subfolder). `loader.test.ts` loads them as `EvalCase[]` in sorted-path order, twice, and asserts `JSON.stringify` is identical. A second test writes files in non-sorted order (plus a `.md` to ignore) and gets sorted, recursive order. |
| Bad case fails loud | `loader.test.ts`: invalid YAML, an unknown `expect` key (`max_wordz`), a missing `source`, an empty file and a duplicate id each throw `CaseLoadError` whose message names the file (and the Zod issue / both files for duplicates). An empty suite dir throws. `schema.test.ts`: each required field missing, empty `expect`, unknown keys, bad limits and an uncompilable `matches` regex fail at parse time. |
| String and structure checks | `checks/string.test.ts` and `checks/structure.test.ts`: pass + fail for `must_contain`, `must_not_contain`, `matches`, `max_words`, `max_chars` (exactly-at-limit passes, one over fails; emoji counts as 1), `must_cite_source` true and false. |
| Judge scoring | `checks/judge.test.ts`: `buildJudgeRequest` is a valid `ModelRequest` (`ModelRequestSchema.parse`), deterministic, `temperature: 0`, carries rubric + reply + transcript. `judge()` calls `generateObject` with `JudgeVerdictSchema` through the 2.6 `ScriptedGateway`; a malformed verdict and a gateway failure both reject; the verdict is re-parsed even if a gateway skipped validation. `runner.test.ts`: a failing verdict fails the turn with the reason as detail. A live judge call with no pinned model throws `JudgeModelConfigError`; the CLI builds the judge from `resolveJudgeModel()` (`EDMATE_JUDGE_MODEL`, no default). |
| `--record` / replay incl. judge outputs | `runner.test.ts` records the fixture suite with `fileRecorder(tmp, 'record')`: 6 agent calls, 4 judge calls, exactly 10 JSON files (`<case>/turn-<n>/agent.json`, `.../judge-<i>.json`); a judge file holds `{ judgeModel, verdict }`. A fresh replay with an agent and a judge gateway that throw if called gives a byte-identical JSON report; the agent spy is never called. Missing fixture → `MissingFixtureError` "run with --record first" (`recorder.test.ts`, `runner.test.ts`, CLI tests); malformed recorded agent/judge data fails naming the key. |
| Deterministic ordering | Loader sorts relative POSIX paths; `runSuite` keeps the given order (test); checks run in a fixed order whatever the YAML key order (test); two replays give equal reports (test). |
| Report output | `report.test.ts`: `toJsonReport` pinned by an inline snapshot, no `generatedAt` unless passed, results deep-copied; `toSummary` → `"1/2 passed\nFAIL test-locked-002 turn 1 must_not_contain: found: \"lesson 9\"\n"`. |
| Fully offline in CI | `packages/evals/test/setup/no-network.ts` and `apps/cli/test/setup/no-network.ts` (vitest `setupFiles`) make the global fetch reject. Judge calls go through the 2.6 `ScriptedGateway` (`@edmate/harness/testing`, devDependency only); replay tests use throwing agent/judge stubs. The CLI's `createJudgeGateway` test only builds adapters with runtime-generated fake keys and an `.invalid` host; no call is made. |
| CLI | `edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]` in `apps/cli`. `commands/eval.test.ts`: record then replay with the unwired agent and no judge (exit 0, report written with injected `generatedAt`), default fixtures dir `evals/fixtures`, failing check (exit 1, summary names it), `--record` without `EDMATE_JUDGE_MODEL` (exit 1, config error, nothing called), replay without fixtures (exit 1, "run with --record first"), bad case file, arg errors, help. `cli.test.ts`: usage lists `eval`, `eval --help` routes. |

Commands (after merging origin/main at `5393345`; clean merge, no lockfile conflict):

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals... --filter=@edmate/cli...` → `Tasks: 22 successful, 22 total`; evals `Tests 93 passed (93)`, cli `Tests 27 passed (27)`.
- evals coverage: `Statements 100% · Branches 97.26% · Functions 100% · Lines 100%`. cli coverage: `Statements 98.5% · Branches 92.3% · Functions 91.66% · Lines 100%`.
- `corepack pnpm install --frozen-lockfile` → "Lockfile is up to date".
- `corepack pnpm turbo run build typecheck lint test --force` → `Tasks: 41 successful, 41 total`.
- `python3 -m unittest discover -s .claude/tests` → `Ran 122 tests ... OK`.
- `python3 .githooks/secret-scan.py --all` → exit 0, no output.
- `corepack pnpm format:check`: only `.github/workflows/ci.yml` is flagged (unformatted on main already, out of bounds).
- `packages/contracts/**`, `packages/harness/**`, `packages/gateway/**`, `evals/suites/**`, `evals/fixtures/**` untouched.

## Fix round 1

| Finding | Fix | Evidence |
|---|---|---|
| [CRITICAL] a case with no `expect` on any turn passes vacuously | `EvalCaseSchema` superRefine: at least one turn must have `expect`; the issue is on `turns` and names the case id. The runner also fails any case where no check ran (`error: 'no checks ran'`). | `schema.test.ts` "rejects a case where no turn has an expect block, naming the case id"; `runner.test.ts` "a case where no check ran fails (no vacuous pass), even if it bypassed the schema". |
| [MEDIUM] `--record` overwrites fixtures silently | `Recorder.overwritten()` lists keys whose fixture existed before the write (file and memory recorders); `toSummary(results, { overwritten })` prints `overwrote N recorded fixture(s):` and one key per line; the CLI passes it. | `recorder.test.ts` (file, replay, memory seed), `report.test.ts` (count, singular, empty), `commands/eval.test.ts` "a second --record lists every fixture it overwrote". |
| [LOW] one case's error aborts the run | `runSuite` catches per case: the case fails with `error` (message), keeps the turns that finished, and the run goes on; `toSummary` prints `FAIL <id> error: <message>`; the CLI exits 1. `runCase` still throws for direct callers. | `runner.test.ts` (error mid-case keeps turn 0 and runs the next case; missing replay fixture recorded per case; non-Error throw), `commands/eval.test.ts` "one erroring case does not hide the others (exit 1)". |

After fix round 1 and merging origin/main at `2628792` (clean merge, no lockfile conflict):

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals... --filter=@edmate/cli...` → `Tasks: 22 successful, 22 total`; evals `Tests 103 passed (103)` (coverage 100% statements/lines/functions, 97.82% branches), cli `Tests 29 passed (29)` (98.52% statements, 100% lines).
- `corepack pnpm install --frozen-lockfile` → up to date; `corepack pnpm turbo run build typecheck lint test --force` → `Tasks: 41 successful, 41 total`.
- `python3 -m unittest discover -s .claude/tests` → OK; `python3 .githooks/secret-scan.py --all` → exit 0.
- `format:check`: only `.github/workflows/ci.yml` (unformatted on main, out of bounds).

## Changes

- `packages/evals`: `schema.ts`, `loader.ts`, `checks/{string,structure,judge,result}.ts`, `judgeModel.ts`, `recorder.ts` (`fileRecorder`, `memoryRecorder`), `agent.ts`, `runner.ts`, `report.ts`, barrel `index.ts`; tests beside each; `test/fixtures/suite/*` (synthetic); `test/setup/no-network.ts`; `vitest.config.ts`, `tsconfig.build.json`, `eslint.config.js`; `package.json` adds `js-yaml@5.5.0` (ships its own types), `zod`, `@edmate/contracts`, test devDeps and `@edmate/harness` (devDependency, tests only).
- `apps/cli`: `commands/eval.ts`, `commands/judgeGateway.ts` + tests; `cli.ts` adds `eval` and becomes async (`run()` returns `Promise<number>`); `bin/edmate` awaits it; `vitest.config.ts` adds the no-network setup; deps on `@edmate/evals`, `@edmate/gateway`, `@edmate/contracts`, devDep `@edmate/harness`.
- `pnpm-lock.yaml` regenerated by install.

## Deviations from the plan

- `TurnResult` also carries the turn's `student` message, so a report reads on its own.
- Recorded judge fixtures store `{ judgeModel, verdict }`, not the bare verdict, so a reviewer sees which pinned model produced it. `RunOptions.judgeModel` is optional: replay needs none; a live judge call without it throws.
- `Recorder` exposes `mode`; `memoryRecorder` returns a `MemoryRecorder` with `snapshot()` (seeds a replay in tests). Added `FixtureReadError` (corrupt/unreadable fixture) and `InvalidFixtureKeyError` (key charset is stricter than the plan: lowercase segments joined by `/`).
- An empty suite directory throws rather than returning `[]`.
- Tests use the 2.6 `ScriptedGateway` from `@edmate/harness/testing` (lead instruction) as a devDependency; `packages/evals/src` never imports `@edmate/harness`.
- `edmate eval` CLI: `run()` is now async (existing tests updated to `await`).
- Added `EDMATE_JUDGE_BASE_URL` for an `openai-compatible` judge (that provider has no default URL).

## Decisions

### 18 Oct 2026 · 3.12 `EvalCase` lives in `packages/evals`, not `packages/contracts` · decided by planner · risk: low
Decided: the case/check shape is a Zod schema owned by `packages/evals`.
Why: it is not in the Core contracts list and nothing outside the eval runner reads it; adding it to contracts would need an ADR.
Alternatives: add it to contracts for symmetry.
Reversible: Yes, by ADR if a second package needs the type.

### 18 Oct 2026 · 3.12 One generic `Recorder` for agent replies and judge outputs · decided by planner · risk: low
Decided: every agent reply and judge verdict goes through one record/replay mechanism, one JSON file per (case, turn, call) at `<fixtures>/<case>/turn-<n>/{agent,judge-<i>}.json`; replay never calls the live function and a missing fixture throws "run with --record first".
Why: "record/replay including recorded judge outputs" becomes one mechanism, and CI replay has no live call path.
Alternatives: a judge-only recorder plus ad hoc agent caching.
Reversible: Yes.

### 18 Oct 2026 · 3.12 No default judge model; `EDMATE_JUDGE_MODEL` required to record · decided by lead (human decision on pinning) · risk: low
Decided: `resolveJudgeModel()` reads `EDMATE_JUDGE_MODEL="<provider>:<model>"` and throws if unset; each recorded judge fixture stores the model that produced it. An `openai-compatible` judge also needs `EDMATE_JUDGE_BASE_URL`.
Why: the model mix is open until 7.6 and the judge is pinned per release by a human; a guessed id could be baked into fixtures.
Alternatives: hard-code a default id.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Agent under test is an injected `EvalAgent`; the CLI's agent stays unwired · decided by planner, accepted by lead (Q1) · risk: low
Decided: the runner takes a minimal `EvalAgent` (`reply({caseId, turnIndex, student, priorTurns}) → {text, sources?}`); `edmate eval` passes an agent that refuses every call until a pipeline exists. Replay still works with recorded agent fixtures.
Why: 3.1 is not built; a one-shot stand-in model would look like real coverage without guards, retrieval or persona.
Alternatives: wire a direct-to-model stand-in now.
Reversible: Yes; a later task passes a real agent.

### 18 Oct 2026 · 3.12 `edmate eval` lives in `apps/cli` · decided by planner · risk: low
Decided: `edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]`; fixtures default to `evals/fixtures`; exit 1 on any failing case or error. `run()` became async.
Why: the build plan's CLI-parity table names `edmate eval` under `apps/cli`.
Alternatives: a bin in `packages/evals`.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Case id charset only; `must_cite_source: false` means "no sources" · decided by planner, accepted by lead (Q2, Q3) · risk: low
Decided: ids must match `^[a-z0-9-]+$` (the `<suite>-<skill>-<nnn>` shape stays an authoring convention); `must_cite_source: false` asserts no sources, omitting it means don't care.
Why: skill names and numbering may change; an explicit "no sources" is useful for off-topic redirects.
Alternatives: enforce the full id shape; treat `false` as don't care.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Eval tests use the 2.6 scripted gateway via a devDependency on `@edmate/harness` · decided by builder · risk: low
Decided: `packages/evals` and `apps/cli` list `@edmate/harness` as a devDependency and import only `@edmate/harness/testing` in tests; no `src` file imports the harness.
Why: the lead asked for the scripted gateway in tests (rule 4); the runtime graph stays one-way (harness does not know evals, evals' shipped code does not need the harness).
Alternatives: a hand-written fake `ModelGateway` in evals.
Reversible: Yes.

### 18 Oct 2026 · 3.12 No vacuous passes; per-case errors; overwrite report · decided by reviewers (fix round 1) · risk: low
Decided: a case must have at least one turn with `expect` (schema), and a case where no check ran fails (runner). `runSuite` records a throwing case as failed with its error and keeps going; `runCase` still throws. `--record` lists every overwritten fixture key with a count in the summary.
Why: a check-free case would report a pass that proves nothing; one bad case shouldn't hide the rest of a run; re-recording should be visible in review.
Alternatives: allow check-free cases; abort the whole run on the first error; overwrite silently.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Strict checks and loud failures · decided by builder · risk: low
Decided: string checks are case-insensitive substrings; `matches` regexes compile with `i` at load time; checks run in a fixed order (`must_contain`, `must_not_contain`, `matches`, `max_words`, `max_chars`, `must_cite_source`, `judge[i]`); an empty suite dir, a malformed recorded fixture or a malformed agent reply throws rather than scoring; fixture keys are restricted to lowercase `/`-joined segments.
Why: deterministic reports and no silent skips.
Alternatives: return `[]` for an empty dir; score malformed data as a fail.
Reversible: Yes.
