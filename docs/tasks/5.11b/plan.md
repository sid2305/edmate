# 5.11b plan: flaky draftOutline order test

READY (lead plan; a small test-determinism fix).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
the test passes 50 runs in a row under load (e.g. --repeat or a loop); no timer race decides which reply a module gets; production drafter order is proven, not assumed

## What happened
CI on PR #98 (a `.claude`-only change) failed `packages/ingest/test/outline/draftOutline.test.ts` › "drafts independent modules in parallel, keeping output order equal to input order" with `expected 'values-variables' to be 'conditions'`. The scripted gateway delays the first module's reply by 10 ms and the second by 0 ms with `setTimeout` (around line 170–190). It passed on re-run.

## Steps
1. Read the test and `packages/ingest/src/outline/` drafter. Find out whether the wrong value comes from the test's reply mapping (which module a reply belongs to) or from the drafter's ordering. If the drafter can really return modules out of input order, that is a production bug: fix it (results placed by input index) and say so in the handoff.
2. Replace the timer race with controlled deferreds: the gateway returns a promise per module id, and the test resolves the second module first explicitly, then the first. Replies are chosen by module id from the request, never by call order.
3. Show it is stable: run that test file 50 times in a row (e.g. `corepack pnpm --filter @edmate/ingest exec vitest run test/outline/draftOutline.test.ts --repeat 50` if supported, otherwise a shell loop) and paste the result.
4. Grep `packages/ingest/test` for other `setTimeout`-based ordering races of the same shape; fix them the same way only if they are equally small, and list them.

## Budget
About 30 tool calls, one phase. Packages: packages/ingest only.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm/turbo for @edmate/ingest, the secret scan, git).

## Exit conditions
- Done: `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...` green, the 50-run loop green, handoff written, branch pushed.
- Stop with `Status: PARTIAL`: past about 45 calls, or the fix needs changes outside packages/ingest.

## Files out of bounds
packages/** other than packages/ingest, apps/**, .claude/**, .github/**.

## Risky paths touched
None expected.

## Decisions (draft)
- Deterministic deferreds, not longer timers · risk: low.
