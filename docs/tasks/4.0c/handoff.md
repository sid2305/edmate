# 4.0c handoff — suite validator follow-ups

Status: DONE
Branch: `m4/4.0c-validator-followups`
Worktree: `.claude/worktrees/agent-a56f7d5a4a7a813ab` (relative to the repo root)

Small follow-up task (no planner), test-first, closing the four deferred findings from
`docs/tasks/4.0/review.md`.

## Changes

1. **File/case pairing can't drift** (`suites.ts:109`). `loader.ts` now exports
   `loadCasesWithFiles(dir)`, returning `{ file, evalCase }[]` in the same sorted-path order
   `loadCasesFromDir` already used; `loadCasesFromDir` is now a one-line wrapper over it, so its
   existing callers (runner.test.ts, loader.test.ts, index.ts) are unaffected. `suites.ts` calls
   `loadCasesWithFiles` directly instead of re-listing the suite directory with `readdirSync` and
   zipping by index — the `files[i] as string` cast is gone. `index.ts` re-exports
   `loadCasesWithFiles` and `LoadedCaseFile` alongside the existing loader exports.
2. **Case-insensitive `pending` match** (`suites.ts:81`). `c.reviewed_by.trim().toLowerCase() === PENDING_REVIEWER` — `" Pending "`, `"PENDING"`, etc. are now flagged; a name that merely contains "pending" (e.g. "ependington") is not.
3. **"suite failed to load" instead of "guard folder has no cases"** (`suites.ts:130`). `validateSuites` now tracks which top-level suites threw during load (`failedSuites`); when `requireAllGuards` is true and a guard's count is 0 because its suite failed to load, the problem reads `"<guard>: suite failed to load"` instead of the generic "has no cases"/"is missing" message (both the load-error problem and this one are still reported — one for the real cause, one for the guard check). When `requireAllGuards` is false the guard still just goes to `unseeded`, unchanged.
4. **Reviewer and all-guards rules on by default** (`suites.test.ts:22`). The real-suites describe
   block now computes `requireReviewed: process.env.EDMATE_ALLOW_PENDING !== '1'` and
   `requireAllGuards: process.env.EDMATE_ALLOW_UNSEEDED !== '1'` — both rules are on unless the new
   opt-out env vars are set to `'1'`. All 300 seeded cases already carry a named `reviewed_by` and
   every guard folder is seeded, so this doesn't change what currently passes; it just makes CI
   enforce it going forward. Comments updated to describe the opt-out, not opt-in, direction.

Each change has a dedicated test on synthetic trees (`suites.test.ts`) or the loader fixture
(`loader.test.ts`); see the diff for the full list, including a pairing test that nests a case one
folder deeper so its file-path sort order runs opposite to its id's lexical order — the scenario a
re-list-and-zip-by-index bug would get wrong.

## Evidence

```
$ export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/evals... --force
...
@edmate/evals:test:  ✓ src/loader.test.ts (11 tests) 46ms
@edmate/evals:test:  ✓ src/suites.test.ts (26 tests) 200ms
@edmate/evals:test:  ✓ src/runner.test.ts (17 tests) 75ms
...
 Tests  132 passed (132)
...
@edmate/evals:test: suites.ts     |     100 |      100 |     100 |     100 |
@edmate/evals:test: loader.ts     |     100 |      100 |     100 |     100 |
 Tasks:    14 successful, 14 total
```

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

`node -v` in this worktree run: `v22.22.3` (via `$HOME/.nvm/versions/node/v22.22.3/bin` on PATH;
`source ~/.nvm/nvm.sh` was refused as a worktree-isolation violation, per the task note).

## Deviations

None from the four listed findings. `index.ts` additionally re-exports the new
`loadCasesWithFiles`/`LoadedCaseFile` — not asked for, but consistent with every other loader
export already being public, and it's what a future caller needing the same pairing (not just
`suites.ts`) would reach for.

## Decisions

### 18 Oct 2026 · 4.0c "Suite failed to load" is reported alongside the load-error line, not instead of it · decided by tdd-guide · risk: low
Decided: when a suite's load throws, `validateSuites` still pushes the `"<suite>: <load error message>"` problem (per-file, naming the real cause) *and*, for each affected guard under `requireAllGuards`, a second `"<guard>: suite failed to load"` line — not a replacement of the first.
Why: the review finding was about a guard folder being reported as merely "empty" when the real cause (a load error) was knowable; dropping the load-error line would lose that cause, and a reader scanning guard-level problems still needs the per-guard line to know which guard is affected.
Alternatives: fold the guard-level line into the load-error line (one line that names both the suite and the guard); only emit the guard-level line and drop the per-suite load error.
Reversible: yes.

### 18 Oct 2026 · 4.0c loadCasesWithFiles is exported alongside loadCasesFromDir · decided by tdd-guide · risk: low
Decided: `loader.ts` exports `loadCasesWithFiles` (and its `LoadedCaseFile` type) publicly from `index.ts`, not just internally to `suites.ts`.
Why: every other loader export is already public, and any future caller needing a case paired with its file (not just `suites.ts`) should reach for this instead of re-deriving the pairing itself.
Alternatives: keep it package-internal (export only from `loader.js`, not `index.ts`) until a second caller exists.
Reversible: yes.
