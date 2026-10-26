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
