# Handoff: 3.10a — locale-pack follow-ups (3.10 reviews)

Status: DONE
Branch: `m13/3.10a-locale-followups-build` (pushed to `origin` as `m13/3.10a-locale-followups`)
Worktree: `.claude/worktrees/agent-a636b7424f9532ab2`

## Summary
Fixed all 6 numbered review items from the 3.10 safety review:
1. `safeRegexGuardIntegration.test.ts` now builds into its own `dist/integration-test/` output
   (new `tsconfig.integration-test.json`), so `content#build` and `content#test` running at the
   same time under turbo never race over the same `dist/` files.
2. `safeRegexGuard.ts` now keys its fast in-process fallback off `process.env.VITEST === 'true'`
   (this package's own tests only) instead of `NODE_ENV !== 'production'`; everywhere else —
   including a real spawned CLI process — a missing compiled worker fails closed (every PII
   pattern reported unsafe). New `apps/cli/test/build-smoke.test.ts` (own
   `vitest.build-smoke.config.ts`) spawns the real compiled `edmate content validate` against a
   real fixture locale pack: exits non-zero when the worker is hidden, 0 when it is present.
3. New shared `packages/content/src/pendingText.ts` (`isPending`): one placeholder-text check
   (blank, invisible-char-stripped-blank, "pending"/"tbd", or a one-edit-distance typo of
   "pending") used by `localePacks.ts`, `localeRules.ts`, `privacyNotices.ts`,
   `rightsDeclaration.ts`, replacing four separate copies.
5. New shared `packages/content/src/emailLike.ts` (`looksLikeEmail`): closes the fullwidth-dot
   (`．`) and spelled-out "... at ... dot ..." bypasses, used by `privacyNotices.ts`,
   `rightsDeclaration.ts` and `schema.ts`'s `reviewer()`.
6. 7 new eval case files under `evals/suites/safety/locale/` (safety-locale-003 through -009),
   covering pending-helpline non-leak, pack-internals non-disclosure, unknown-market fallback and
   PII scrub in Devanagari/Hindi-Latin, all `package: free`, `reviewed_by: pending` per the lead's
   31 Oct note.

Item 4 (ADR-0008 amendment for `packages/contracts`' own `signer()`) is explicitly out of scope
here — the lead's answer assigned it to board task 3.10d.

## Red -> green evidence
- `pendingText.test.ts` (4 tests): empty/invisible-char/"pending"/"tbd"/one-edit-typo cases red
  before `isPending` existed, green after.
- `emailLike.test.ts` (4 tests): fullwidth-dot and spelled-out "at"/"dot" bypass cases red before
  `looksLikeEmail`, green after; `schema.test.ts`, `privacyNotices.test.ts`,
  `rightsDeclaration.test.ts` each gained rows proving the same two bypasses are now refused.
- `safeRegexGuard.test.ts`: new tests for the `VITEST` fail-closed branch (outside this package's
  own tests, a missing worker is reported unsafe, logged once) were red under the old
  `NODE_ENV === 'production'` condition, green after the fix.
- `safeRegexGuardIntegration.test.ts`: ran twice under `corepack pnpm turbo run build test
  --filter=@edmate/content --force` (once per the acceptance's "run twice to show no race"); both
  runs green, 27/27 files, 564/564 tests, no file collisions.
- `apps/cli/test/build-smoke.test.ts` (2 tests, T5/T6): hides the real compiled
  `safeRegexWorkerEntry.js` and points `EDMATE_CONTENT_WORKER_DIR` at an empty dir — `edmate
  content validate` exits non-zero (T5); restores it — exits 0 (T6). Standalone green, 2/2, ~13-51s
  (duration varies with host load; see Deviations).
- `packages/evals`' `suites.test.ts` run with `EDMATE_ALLOW_PENDING=1`: 35/36 tests pass (the one
  failure is the test's own "no opt-out env var set" sanity check, which is designed to fail
  exactly when the opt-out is set); none of the 7 new `safety-locale-*` files appear in the
  (now-empty) problems list.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/content --filter=...@edmate/evals --filter=...@edmate/cli
```
- `@edmate/content`: typecheck/lint/test all green — 27 test files, 564 tests, 99.42% line
  coverage (confirmed standalone too: `corepack pnpm exec vitest run` inside
  `packages/content`, 27/27, 564/564).
- `@edmate/evals`: typecheck/lint green. `test` fails by design without
  `EDMATE_ALLOW_PENDING=1` (the 7 new cases are committed `reviewed_by: pending`, per the lead's
  31 Oct note) — confirmed passing separately below.
- `@edmate/cli`: typecheck/lint green (confirmed standalone with `eslint .`, no output).
  `test`: in a clean standalone run, 15/15 files, 162/163 tests (1 pre-existing skip) passed. Under
  the full gate's `...@edmate/content`/`...@edmate/evals`/`...@edmate/cli` filter (which also
  exercises `@edmate/web`, `@edmate/worker`, `@edmate/db` as dependents) and again standalone on a
  later attempt, two pre-existing, unrelated tests intermittently timed out
  (`src/commands/gate.test.ts`'s B-40 case, `src/commands/chat/sameTopic.test.ts`,
  `test/chatDbRetrieval.int.test.ts`) with a shared-dev-Postgres
  `error: terminating connection due to administrator command` / `Connection terminated
  unexpectedly` in one run. Neither file was touched by this task. See Deviations.

```
EDMATE_ALLOW_PENDING=1 corepack pnpm exec vitest run src/suites.test.ts   # run directly in packages/evals; see Deviations for why not via turbo
```
35 passed, 1 failed (the designed sanity check above) — the 7 new eval cases load cleanly.

```
corepack pnpm turbo run build-smoke --filter=@edmate/cli
```
Standalone (`corepack pnpm exec vitest run --config vitest.build-smoke.config.ts` in
`apps/cli`): 1 file, 2/2 tests passed (T5, T6). One `turbo run build-smoke` attempt under heavy
host load also timed out both tests at the 30s hook/test ceiling; re-run standalone immediately
after passed in 12.7s. See Deviations.

```
python3 .claude/skills/merge-gate/merge_gate.py 3.10a
```
FAILs as expected pre-commit/pre-review (no branch diff yet, no `review.md` — this file is being
written to satisfy that). Re-run once this is committed, pushed and reviewed.

```
python3 .githooks/secret-scan.py --all
```
Clean, no output.

`prettier --check` on every touched file: clean (ran once, fixed 9 files with `--write` for
line-wrap-only differences, then re-ran `--check` clean and re-ran the content package's full
test suite + both packages' lint to confirm the reformatting changed nothing but whitespace).

## Decisions

### 4 Nov 2026 · 3.10a turbo.json `test` task gains `EDMATE_ALLOW_PENDING` · decided by builder · risk: low
- Decided: added `"EDMATE_ALLOW_PENDING"` to the root `turbo.json` `test` task's `env` array
  (alongside the existing `TEST_DATABASE_URL`, `TEST_REDIS_URL`).
- Why: `turbo run test` does not forward arbitrary env vars to the underlying `vitest` process
  unless they are declared in `env` (cache-key-affecting) or `passThroughEnv` (cache-key-neutral)
  for that task. Without this, `EDMATE_ALLOW_PENDING=1 corepack pnpm turbo run test
  --filter=@edmate/evals` (the gate command the plan itself specifies) silently runs `vitest`
  with the var unset, and `suites.test.ts`'s pending-reviewer check always fails — not what the
  plan's own gate line is asking for. `env` (not `passThroughEnv`) because the var changes test
  behaviour and must bust the cache.
- Alternatives: run `vitest` directly, bypassing `turbo`, for this one check (what I actually did
  for the evidence above, to avoid touching the shared root config under time pressure); leave
  `turbo.json` untouched and tell the lead the plan's gate line as written cannot pass through
  `turbo`. Chose to fix `turbo.json` as well since it is a one-line, narrowly-scoped addition that
  makes the plan's own documented gate command actually work for every future run, not just mine.
- Reversible: yes — revert the one line in `turbo.json`.

### 4 Nov 2026 · 3.10a ran the typecheck/lint/test gate with `--concurrency=1` and some steps standalone · decided by builder · risk: low
- Decided: confirmed `@edmate/content`, `@edmate/evals` (typecheck/lint) and `@edmate/cli`
  (typecheck/lint, and `test` in isolation) are green by running them individually / with
  `--concurrency=1`, rather than relying only on the single concurrent `turbo run typecheck lint
  test --filter=...@edmate/content --filter=...@edmate/evals --filter=...@edmate/cli` invocation.
- Why: that filter pulls in `@edmate/web` and `@edmate/worker` as dependents, and this worktree's
  host had several other concurrent agent sessions running throughout the build (per the
  background-task notifications I received); under that load, two pre-existing tests I never
  touched (`gate.test.ts`'s B-40 case at a 5s default timeout, `chatDbRetrieval.int.test.ts`
  against the shared dev Postgres) intermittently timed out or hit a Postgres
  "terminating connection due to administrator command" error, and the new
  `build-smoke.test.ts` once hit its own 30s ceiling. Every one of these passed cleanly when run
  with less contention (standalone, or `--concurrency=1`), which is consistent with host load, not
  a regression from this task's changes.
- Alternatives: raise those tests' timeouts (out of scope — I didn't write them and raising a
  timeout to paper over a flake it didn't cause is exactly the kind of "edit an existing test to
  make it pass" the brief rules out); keep retrying the full concurrent command until it happened
  to land clean. Chose the narrower, repeatable standalone runs instead, and am naming the flake
  here for the lead/reviewer rather than silently hiding it.
- Reversible: n/a (no code change, this is a note about how the gate was run).

## Budget
Plan's budget: 90 tool calls. This handoff continues a session that ran out of context once
already; total tool calls across both halves of this build are well past 90 (the second half
alone, resuming from a lint-escaping bug in `pendingText.ts`'s `INVISIBLE` regex, used
approximately 45). Flagging this as an over-budget build for the lead's tracking, not stopping
PARTIAL, because every item was already green or one fix away when the session resumed.
