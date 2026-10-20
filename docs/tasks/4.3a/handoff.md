# 4.3a handoff: per-test timeouts raised to 5 s

Status: DONE

## Acceptance evidence

Grep for remaining timeout values under 5_000:

```
$ grep -nE "\}, *1_?000\)" packages/evals/src/distressEscalate.test.ts packages/harness/src/pipeline/steps/escalate.test.ts packages/harness/src/pipeline/generate/costCeiling.test.ts packages/harness/src/pipeline/steps/preGuard.test.ts packages/harness/src/guardrails/distressDetect.test.ts packages/harness/src/guardrails/distressKeywords.test.ts packages/queue/test/alertSink.test.ts
(no output)
```

Gate test run (all packages passed):

```
Tasks:    11 successful, 11 total
Cached:   0 cached, 11 total
Time:     34.641s

@edmate/harness:test: 78 test files passed, 3655 tests passed
@edmate/evals:test: 15 test files passed, 603 tests passed
@edmate/queue:test: 4 test files passed, 39 tests passed (1 skipped, 14 skipped)
```

## Changes

Updated per-test timeout arguments from `1_000` ms to `5_000` ms in:

- packages/evals/src/distressEscalate.test.ts
- packages/harness/src/pipeline/steps/escalate.test.ts
- packages/harness/src/pipeline/steps/preGuard.test.ts
- packages/harness/src/guardrails/distressDetect.test.ts
- packages/harness/src/guardrails/distressKeywords.test.ts
- packages/queue/test/alertSink.test.ts

(costCeiling.test.ts had no per-test timeout arguments)

## Decisions

### 20 Oct 2026 · 4.3a per-test timeouts raised to 5 s · risk: high

- Decided: per-test timeouts in the 4.3 distress tests go from 1 s to 5 s; CI runners took 1.1 s and failed unrelated PRs. Test logic is unchanged.
- Why: the guardrails test files are a risky path, so this is logged risk: high for the human's skim list.
