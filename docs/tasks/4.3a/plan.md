# 4.3a plan: raise 1 s per-test timeouts (CI flake)

Status: READY (lead-written; mechanical)

## Why
4.3 added explicit `1_000` ms per-test timeouts. On CI runners two different tests took about 1.1 s and failed
PR #60 twice (run 39440391131: preGuard "classifier false → ok", distressDetect "escalates with a valid alert").

## Change
In these test files, replace every per-test timeout argument of `1_000` (or `1000`) with `5_000`. Change
nothing else (no test logic, no assertions):
- packages/evals/src/distressEscalate.test.ts
- packages/harness/src/pipeline/steps/escalate.test.ts
- packages/harness/src/pipeline/generate/costCeiling.test.ts
- packages/harness/src/pipeline/steps/preGuard.test.ts
- packages/harness/src/guardrails/distressDetect.test.ts
- packages/harness/src/guardrails/distressKeywords.test.ts
- packages/queue/test/alertSink.test.ts

Only touch a `1_000`/`1000` that is the last argument of `it(...)`/`test(...)`; a `1000` inside a test
(fake timers, durations) stays.

## Acceptance
`grep` finds no per-test timeout under 5_000 in those files; the harness, evals and queue suites pass.

## Risky paths touched
packages/harness/src/guardrails/*.test.ts (guardrails group): code-reviewer, plus `risk: high` in the handoff.
