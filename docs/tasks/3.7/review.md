# 3.7 review — APPROVE
Reviewers: safety-reviewer (opus), security-reviewer (sonnet), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

security-reviewer and typescript-reviewer approved the first build. safety-reviewer (1 HIGH) and silent-failure-hunter (1 CRITICAL, 2 HIGH) asked for changes. One fix round (a7bb329) addressed everything, and both re-verified it: APPROVE. Harness 2,292 tests pass; the generate files are at 100% coverage. Contracts are untouched and the secret scan is clean.

## Findings
- [CRITICAL] [fixed] packages/harness/src/pipeline/runner.ts:750 — failed generate attempts were never reported. Every attempt is now reported as GenerateAttemptFailed (error name only).
- [HIGH] [fixed] packages/harness/src/pipeline/generate/toolLoop.ts:139 — tool output went back to the model unchecked against the answer key. It is now checked with the shared normalised helper and fails on a hit.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/toolLoop.ts:134 — runTool discarded the real exception. It now reports ToolFailed by name.
- [HIGH] [fixed] packages/harness/src/pipeline/runner.ts:269 — unpriced usage was recorded at $0. It is now kept out of meter and reported as UnpricedUsage.
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/skillEvent.ts:62 — the raw substring answer-key check is replaced by answerKey.ts (NFKC, separators and zero-width characters stripped).
- [MEDIUM] [fixed] packages/harness/src/pipeline/runner.ts:213 — the runner-bug error path now sends `replace ''` first.
- [MEDIUM] [fixed] packages/harness/src/pipeline/backgroundLog.ts:25 — foreign error messages were logged. Now names only; messages only for HarnessError.
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/streamReader.ts:79 — a late close could be lost. Closes are now tracked and settled before `finished`.
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/skillEvent.ts:51 — SkillEventDropped had no cause. It now carries the error name.
- [LOW] [fixed] packages/harness/src/pipeline/runner.ts:233 — skill events now count as shown, so `replace ''` clears them.
- [LOW] [fixed] packages/harness/src/pipeline/generate/toolLoop.ts:120 — `not_available` is now checked before `too_many_calls`.
- [MEDIUM] [deferred 4.5] packages/harness/src/pipeline/generate/answerKey.ts:6 — also strip `\p{Cf}` (soft hyphen) and fold `\p{Nd}` digits (Devanagari) to ASCII. 4.5 reuses this helper.
- [LOW] [deferred 4.5] packages/harness/src/pipeline/index.ts:15 — the exported HarnessError base: document that messages must be fixed text only.
- [LOW] [deferred 4.7] packages/harness/src/pipeline/runner.ts:462 — check `sources` against ctx.retrieved by chunk id.
- [LOW] [deferred 9.4] packages/harness/src/pipeline/sse.ts:5 — the client drops text and skill events from a turn with no `done`.
