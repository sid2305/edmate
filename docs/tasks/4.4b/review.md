# Review: 4.4b — APPROVE
Reviewers: code-reviewer

## Findings
- [LOW] [deferred 4.4i] packages/harness/src/pipeline/steps/preGuard.ts — `prefetchDistress` hard-codes `DISTRESS_CLASSIFIER_TIMEOUT_MS` rather than using the guard's `classifierTimeoutMs` option. This is harmless today, because every call site uses the default. Fix: pass the guard's configured timeout through.

- [CRITICAL] [fixed] packages/harness/src/pipeline/steps/preGuard.ts — found by CI (PR #424), not a reviewer. The prefetch ignored an earlier guard's decisive rule hit, so rule-decided turns made classifier calls, and 430 evals failed in distressEscalate and moderationJailbreak. Fixed in fix round 1 (992656f9). @edmate/evals: 1993 tests, 0 failures.

## Notes
- code-reviewer: APPROVE. It ran the vitest run over `src/pipeline/steps/preGuard.test.ts` and `src/guardrails` (1788/1788 pass), plus typecheck and lint for @edmate/harness. It confirmed:
  - every prefetch has a rejection handler when it is created;
  - unused prefetches are cancelled through the step token, and are bounded by their own deadline;
  - a prefetch records no event, strike or alert;
  - each guard has a fail-closed test;
  - rule checks are shared, so a prefetch can't disagree with its guard;
  - the concurrency test would fail under sequential calls.
- safety-reviewer is waived per PR until 13.3 (MVP-first, 20 Oct 2026). The lead logs risk: high.
