**Status:** DONE

## Cause
The test `drafts independent modules in parallel, keeping output order equal to input order`
(`packages/ingest/test/outline/draftOutline.test.ts`) used real `setTimeout` delays (10 ms for the
first module, 0 ms for the second) in the scripted gateway stub to force the second module's reply
to resolve first, then asserted on `resolveOrder[0]`. Under CI load the event loop can fall behind
by more than 10 ms before the timer phase runs; when that happens both timers become due in the
same tick and Node processes them in insertion order (module 0 was registered before module 1, so
it fires first) rather than by delay. That is a systematic failure mode under load, not a rare coin
flip — it explains the two same-message failures the lead saw on PR #98, and matches the exact
`expected 'values-variables' to be 'conditions'` message (module 0's id where module 1's was
expected).

**Production code is not the bug.** `draftOutline` calls `Promise.all(modules.map(...))`, and
`Promise.all` always returns results in the order of the input array regardless of which promise
settles first — this is a JS language guarantee, not timing-dependent. Checked `git log` for
`packages/ingest` on `origin/main`: no commits since PR #97 (5.11a is the last), so there was no
main-only ingest change that could have introduced a real ordering regression either.

## Fix
Replaced the timer race with explicit deferred promises keyed by module id (a `Map<moduleId,
Promise>` plus matching `resolve` callbacks). The gateway stub still picks the reply to return by
finding which module's chunk ids appear in the request content (never by call order), but now the
test resolves module 1's deferred promise first and module 0's second, with no timer involved at
all — deterministic regardless of CPU load.

## Other races checked
`grep -rn "setTimeout" packages/ingest/test` — no other matches. No other ordering races of this
shape exist in `packages/ingest/test`.

## Files
- `packages/ingest/test/outline/draftOutline.test.ts` — rewrote the one flaky test to use deferred
  promises instead of `setTimeout` delays.

## Tests
```
source ~/.nvm/nvm.sh  # or: export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH
corepack pnpm --filter @edmate/ingest exec vitest run test/outline/draftOutline.test.ts
# Test Files  1 passed (1) / Tests  8 passed (8)

# 50-run loop (shell loop; vitest run mode does not support --repeat)
for i in $(seq 1 50); do
  corepack pnpm --filter @edmate/ingest exec vitest run test/outline/draftOutline.test.ts \
    2>&1 | grep -E "Tests|failed"
done | sort | uniq -c
# output:  50       Tests  8 passed (8)

corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...
# Tasks: 14 successful, 14 total (draftOutline.ts coverage: 100/100/100/100)

python3 .githooks/secret-scan.py --all
# clean, no output
```

## Decisions
- Deterministic deferreds instead of longer/staggered timers · risk: low. Keeps the test's intent
  (prove output order is independent of settle order) without any dependency on wall-clock timing,
  so it cannot flake under CI load.
- No production change: `Promise.all` already guarantees output order follows input order; the bug
  was entirely in the test's own ordering mechanism, confirmed by reading `draftOutline`'s use of
  `Promise.all(modules.map(...))` and by `git log origin/main -- packages/ingest` showing no
  ingest-only change since PR #97 (5.11a) that could explain a drafter regression · risk: low.

Tool calls used: 11
