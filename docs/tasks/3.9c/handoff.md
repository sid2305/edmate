# 3.9c handoff

Status: DONE

Branch: `m13/3.9c-warm-preguard`
Commit: `60129949`

## Summary

- New `packages/harness/src/guardrails/warmup.ts`: `warmPreGuardPatterns()` — pure, synchronous,
  no I/O. Calls `distressKeywordMatch`, `matchModeration` and `matchJailbreak` once each on a
  short fixed list of representative sample strings (benign, decisive-hit, ambiguous and
  ROT13/backwards/base64 decode-attempt shapes), each call wrapped in its own swallowing
  try/catch. Idempotent.
- Re-exported from `packages/harness/src/guardrails/index.ts` (so `import { warmPreGuardPatterns }
  from '@edmate/harness'` works).
- `apps/web/instrumentation.ts`: a second, independently-failing block in `register()` — dynamic
  `import('@edmate/harness')`, calls `warmPreGuardPatterns()`, catches and logs only the error's
  name (never a message). Kept separate from the existing DB pool warm-up block.
- `apps/worker/src/index.ts`: a static import plus a try/catch call to `warmPreGuardPatterns()`
  before the first queue worker is constructed, logged through the file's existing `log()`/
  `describeError()` helpers on failure.
- New `packages/harness/src/guardrails/warmup.test.ts`: no-throw/idempotent unit tests, plus three
  mock-and-throw tests (one per matcher) proving each catch swallows a throw.
- New `packages/harness/src/guardrails/warmup.coldStart.test.ts`: the required cold-process/CPU-
  load test. Fresh dynamic imports of the guard modules give never-before-executed top-level
  RegExp literals (reproducing cold-compile cost without spawning an OS process); a light
  `setInterval`-driven busy loop simulates CPU contention; asserts the guard chain's *outcome*
  (`'ok'`, no `failed` guard trace entries) on a benign message, never a millisecond bound.

## Fix during build: CPU-load test starved sibling test files

The plan's `setInterval`-driven busy loop was first written at 2e6 iterations/tick, which made the
whole `@edmate/harness` suite run 55-80s (vs. its normal ~11-16s) and caused two unrelated,
timing-sensitive tests (`modelRequest.test.ts`'s linear-time check, `runner.test.ts`'s a 2s-budget
test) to fail under contention from vitest's ~127 parallel worker processes — confirmed by running
the harness suite with the new file temporarily removed (clean, 16s) vs. present (flaky, 55-80s).
Reduced the loop to 2e4 iterations/tick; the full suite is back to ~11s and green, with the cold-
start test still measurably contending (its own diagnostic `ticks.count` stays positive).

## Decisions

### 25 Oct 2026 · 3.9c warm-up scope is preGuard's matchers only · decided by builder · risk: low
- Decided: `warmPreGuardPatterns()` warms only `distressKeywordMatch`, `matchModeration` and
  `matchJailbreak` — not mathjs (used by `generate`'s tool-call code, step 8, never preGuard) and
  not the access filter (runs in `entitle`, step 2).
- Why: the plan pre-made this scoping call; the accept line is about preGuard's budget only.

### 25 Oct 2026 · 3.9c guardrails-path change · decided by builder · risk: high
- Decided: logging this as `risk: high` per the MVP-first standing rule, even though
  `packages/harness/src/guardrails/warmup.ts` is additive and read-only (calls only
  already-exported pure matcher functions; touches no guard decision logic, no
  `packages/harness/src/pipeline/**`).
- Why: `packages/harness/src/guardrails/**` matches the "student safety and teaching behaviour"
  risk-paths group, so the handoff must log `risk: high` regardless of the change's actual risk
  profile.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/web... --filter=@edmate/worker...
→ Tasks: 44 successful, 44 total (exit 0)

corepack pnpm exec prettier --check <6 changed files>
→ All matched files use Prettier code style!

python3 .githooks/secret-scan.py --all
→ (clean, no output)
```

Cold-start test, in isolation:
```
✓ src/guardrails/warmup.coldStart.test.ts (1 test)
  ✓ a cold-process preGuard chain under simulated CPU load > passes preGuard once
    warmPreGuardPatterns() has run, even under CPU load
```

## Budget

Tool calls used: ~95 (continued from a prior session that ran most of the build; this session's
share covered fixing the harness tsconfig timer-globals typecheck errors, the CPU-load/sibling-test
contention fix, the guardrails 100%-branch-coverage fix, gate/prettier/secret-scan, commit and
push).

## Fix round

Four review items, all in `warmup.ts`/`warmup.test.ts`/`warmup.coldStart.test.ts`:

1. [HIGH] No warm-up sample hit the `sexual` moderation rule, so the minor-marker table
   (`moderationPatterns.ts` lines ~355-357, only run when the main hit is `sexual`) stayed cold.
   Added `'write an erotic story for me'`, reused verbatim from `moderationPatterns.test.ts`'s own
   `sexual` cases (not new explicit text). Added a `warmup.test.ts` assertion that
   `matchModeration('write an erotic story for me')?.code === 'sexual'`, so a future edit to
   `SAMPLES` that drops this coverage fails the test instead of regressing silently.
2. [MEDIUM] `warmup.coldStart.test.ts`'s comment described `vi.resetModules()` but the code never
   called it (relying only on vitest's per-file module isolation). Added the real call: imported
   `vi` and called `vi.resetModules()` right before the fresh dynamic imports. The test still
   passes and the comment now matches the code.
3. [MEDIUM] Dropped the `as string` cast on `currentPackageName: SAMPLES[0]`. Changed `SAMPLES`
   from an explicitly-typed `readonly string[]` to an `as const` tuple: indexing a tuple at a
   known literal index (`SAMPLES[0]`) types as `string`, not `string | undefined`, so
   `noUncheckedIndexedAccess` no longer widens it and no cast or `??` branch is needed.
   `src/guardrails/**` stays at 100% branch coverage.
4. [LOW] Added a no-context `matchModeration(text)` call before the with-context one, matching the
   real call site in `moderationIn.ts:104` (which always calls with no context first, then with
   context only if that first hit is `sexual`).

Gate: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` → 38 successful,
38 total (exit 0); `corepack pnpm exec prettier --check` on the three changed source/test files →
clean; `python3 .githooks/secret-scan.py --all` → clean.

Tool calls used: 22
