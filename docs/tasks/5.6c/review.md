# 5.6c review — APPROVE

Reviewers: architect (opus), security-reviewer (opus), typescript-reviewer (opus), code-reviewer (sonnet)

The architect reviewed the plan and ADR-0011. The fix round (d952f20) was verified by fresh typescript-reviewer and security-reviewer passes (sonnet).

## Findings

- [HIGH] [fixed] packages/harness/src/pedagogy/helpState.ts:71 — practiceCarriedKey had a 64-entry cap while issuing bounds only JSON length, so skipping an item with 65+ keys made the help state unreadable. Fix round removed the entry cap; runner tests cover 65 carried keys and a no-save turn.
- [MEDIUM] [fixed] packages/ingest/src/answerBank.ts:51 — the markdown raw-line check replaced the word-boundary rule and let list, quote, emphasis, heading and flow-key bank shapes through. Fix round widened lineKeyPattern and added flowKeyPattern; security re-review verified all shapes, prose non-refusal and linear ReDoS behaviour.
- [MEDIUM] [wontfix] packages/harness/src/pipeline/runner.ts:1144 — the carried key comes from the loaded state, so a key solved this turn is still guarded for one more turn. This fails closed (an extra do-not-say entry, never a leak); see the lead decision.
- [LOW] [deferred 5.6d] packages/harness/src/pedagogy/helpState.ts:71 — carried-key entries allow empty strings; use z.string().min(1).
- [LOW] [deferred 5.6d] packages/harness/src/pipeline/assemble.test.ts:61 — the allow-list test compares the schema keys with themselves; assert a literal key list.
- [LOW] [deferred 5.6d] packages/harness/src/pipeline/assemble.ts:17 — the compile-time guard checks key names only, not value types (zod catches it at runtime).
- [LOW] [deferred 5.6d] packages/ingest/src/index/indexDocument.ts:64 — the BOM replace is redundant after TextDecoder.
- [LOW] [deferred 5.6d] packages/harness/src/pipeline/runner.ts:1128 — the HelpState comment says "exactly one turn"; it is one saved turn.
- [LOW] [deferred 5.6d] packages/harness/src/pipeline/runner.ts:1145 — a loaded non-practice answerKey replaced by a new item is not carried (no path sets one today).
- [LOW] [fixed] packages/harness/src/pipeline/runner.ts:1146 — same root cause as the helpState HIGH (64-entry cap against a JSON-length bound); fixed with it.
- [LOW] [fixed] docs/adr/0010-practice-items-from-tool.md:42 — the plan said bullet 1; the amendment is on bullet 2, and ADR-0011 now says bullet 2.
