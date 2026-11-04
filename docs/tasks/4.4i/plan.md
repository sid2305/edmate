# Task 4.4i: Distress prefetch uses the guard's configured timeout

Plan written by the lead (small change; no planner needed).

## Acceptance (verbatim)
"a test with a non-default distress classifierTimeoutMs shows the prefetch uses it; the gate passes with --filter=...@edmate/harness"

## Problem
`prefetchDistress` in `packages/harness/src/pipeline/steps/preGuard.ts` (task 4.4b) calls the distress classifier with the hard-coded `DISTRESS_CLASSIFIER_TIMEOUT_MS`. `createDistressDetectGuard({ classifierTimeoutMs })` takes its own deadline. Today production builds the guard with defaults (`defaultPreGuardRegistry`), so the two agree. A registry built with a custom timeout would get the default on the prefetch path without anyone noticing.

## Design
1. `createDistressDetectGuard` returns `DistressDetectGuard`, a `Guard<PreGuardCtx> & { readonly classifierTimeoutMs: number }`, with the resolved value (option ?? default). This doesn't change the `Guard` type. Export the type beside the factory.
2. `createPreGuardStep(registry)` looks up the registered guard named `distressDetect` once, when the step is created (not per turn). It reads `classifierTimeoutMs` when present and is a finite number above 0, and otherwise uses `DISTRESS_CLASSIFIER_TIMEOUT_MS`. It passes that value into `prefetchDistress`. A registry with no distress guard keeps today's behaviour.
3. No change to fail-closed behaviour, call counts, chain order, or the moderation and jailbreak prefetches.

## Tests first (`packages/harness/src/pipeline/steps/preGuard.test.ts`)
- **Non-default timeout:**
  - Build a registry with `createDistressDetectGuard({ classifierTimeoutMs: 50 })` plus the other two default guards.
  - Script the distress classifier to answer after 100 ms (fake clock, as in the existing timeout tests), with a non-hard distress message.
  - Show the prefetched distress call times out at 50 ms and the guard fails closed, exactly as it does today at the default deadline.
  - Show red first, against the current code that uses 230 ms.
- **Default:** a registry built with `defaultPreGuardRegistry()` still uses `DISTRESS_CLASSIFIER_TIMEOUT_MS`. The existing tests already cover this; name the one that does in the handoff.
- **Unit:** `createDistressDetectGuard({ classifierTimeoutMs: 50 }).classifierTimeoutMs === 50`, and `createDistressDetectGuard().classifierTimeoutMs === DISTRESS_CLASSIFIER_TIMEOUT_MS`.

## Risky paths
- `packages/harness/src/guardrails/distressDetect.ts` is under `packages/harness/src/guardrails/**` (the student-safety group: code-reviewer, safety-reviewer waived until 13.3). The review is code-reviewer, plus a lead `risk: high` decision on merge.
- `pipeline/steps/preGuard.ts` is not on a risk path.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals`
- Plus `corepack pnpm --filter @edmate/evals test`, run explicitly, with its count pasted into the handoff.

## Budget
25 tool calls, with a hard stop at 30.

## Hold (4 Nov 2026)
Don't build yet. It touches `guardrails/**` (a risk path), and the human's 4 Nov instruction is "no planning of new risky tasks until further notice" while another project shares the subscription. Start it once that limit is lifted.
