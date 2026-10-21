# 5.6 review — APPROVE

Reviewers: architect (opus), security-reviewer (opus), typescript-reviewer (opus), code-reviewer (sonnet)

The architect reviewed ADR-0010's conditions and raised one HIGH: bank items were served without a runtime check. The typescript-reviewer raised one HIGH: the content snapshot was stale after the pack rewording, so CI was red. One fix round (opus tdd-guide, 3a66e20) fixed both, plus four MEDIUMs:
- practice stuck after one item;
- no `addKeys` failed open;
- unbounded ids;
- a dead `practiceAnswerKey` field.

The architect re-checked the fixes and approved. The security-reviewer approved with no CRITICAL or HIGH: no client path for a key on the issuing turn, on a retry or through the item union. The code-reviewer approved after the fix round. Everything left fails closed and goes to 5.6b (matcher) or 5.6c (before any real practice bank).

## Findings
- [HIGH] [fixed] packages/harness/src/tools/practiceItems.ts:100 — validateItem never ran at runtime; pickItem now checks every item (own key, servable kind, scope, id cap) and fails closed (architect).
- [HIGH] [fixed] packages/content/src/__snapshots__/promptPacks.snapshot.test.ts.snap — not regenerated after the practice@1.1.0 rewording; CI red (typescript-reviewer).
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/answerKey.ts:443 — a held key "1" matched `"level":1` in the item JSON and the generator ignored exclude, so practice got stuck; item tools are now checked on shown text only and the generator varies operands (security-reviewer, typescript-reviewer).
- [MEDIUM] [fixed] packages/harness/src/pipeline/steps/generate.ts:183 — `addKeys?.()` failed open; the rest of the attempt is now held (typescript-reviewer, architect).
- [MEDIUM] [fixed] packages/harness/src/tools/practice.ts:32 — item ids and the key union were unbounded against HelpState limits; capped and fail closed (security-reviewer, architect).
- [MEDIUM] [fixed] packages/harness/src/pipeline/runner.ts:975 — gen.practiceAnswerKey was never read; now unioned into postGuard's keys (typescript-reviewer, security-reviewer).
- [MEDIUM] [fixed] packages/harness/src/tools/practice.ts:188 — `find(...) as string` hid undefined; now fails closed (typescript-reviewer).
- [MEDIUM] [fixed] docs/adr/0010-practice-items-from-tool.md — "the client never sees the key" overstated; corrected (security-reviewer).
- [MEDIUM] [deferred 5.6c] packages/harness/src/pedagogy/compose.ts:220 — on later turns the raw key is in the model's do-not-say prompt; an injection could get it spelled out (security-reviewer).
- [MEDIUM] [deferred 5.6c] packages/harness/src/tools/demoPracticeBank.ts:154 — pick and answerKeyFor ignore teacherId; isolation rests on unique module ids (architect, security-reviewer).
- [MEDIUM] [deferred 5.6c] packages/harness/src/tools/practiceItems.ts:282 — validateItem checks the own key against the prompt only, not options or id (architect re-check).
- [MEDIUM] [deferred 5.6c] packages/harness/src/tools/practice.ts:60 — the generated-id shape is parsed by two separate regexes (code-reviewer).
- [MEDIUM] [deferred 5.6b] packages/harness/src/pipeline/generate/answerKey.ts — generated sum prompts and later hints quoting the sum trip the matcher (fail closed) (typescript-reviewer).
- [LOW] [deferred 5.6c] packages/harness/src/pipeline/runner.ts:1135 — a new item replaces earlier held keys, so a skipped item's answer is no longer guarded (security-reviewer).
- [LOW] [deferred 5.6c] packages/harness/src/pipeline/runner.practiceAnswerKey.test.ts:133 — expectNoLeak doesn't scan skill events or the generated key (typescript-reviewer).
- [LOW] [deferred 5.6c] packages/harness/src/tools/practiceItems.ts:200 — GEN_ID operands unbounded; the "can never throw" comment is wrong (typescript-reviewer).
- [LOW] [deferred 5.6c] packages/harness/src/tools/practice.ts:204 — takes the first allowed module that resolves an id, not exactly one; generatedItemModuleId has no direct unit test (architect, code-reviewer).
- [LOW] [deferred 5.6c] content/prompt-packs/practice@1.1.0.md — the code-output rule's "may be shown as given" sentence conflicts with "don't repeat"; left for the human's sign-off (B-26) (pedagogy-author).
