# 4.3a handoff: per-test timeouts raised to 5 s

Status: DONE

## Acceptance evidence

Grep confirms all timeout values changed (both `}, 1_000)` and line-start `1_000,` patterns):

```
$ grep -nE "\}, *1_?000\)|^    1_?000," packages/evals/src/distressEscalate.test.ts packages/harness/src/pipeline/steps/escalate.test.ts packages/harness/src/pipeline/steps/preGuard.test.ts packages/harness/src/guardrails/distressDetect.test.ts packages/harness/src/guardrails/distressKeywords.test.ts packages/queue/test/alertSink.test.ts
(no output)
```

Harness tests pass after multi-line timeout fix: `Tasks: 2 successful, 2 total`

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

### 20 Oct 2026 · 4.3a the 2 s speed bound in distressKeywords stays · risk: high
- Decided: the 2_000 timeout on "a 4,000-character message is checked quickly" is the test's speed bound, not a generic timeout, so it stays (code-reviewer MEDIUM, wontfix).
- Why: raising it would weaken the check that the keyword regexes stay fast on long input.
