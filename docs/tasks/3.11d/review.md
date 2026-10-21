# 3.11d review — APPROVE
Reviewers: safety-reviewer (opus), architect (opus), typescript-reviewer (opus), security-reviewer (sonnet), code-reviewer (sonnet)

Teacher turns move to the user channel under a platform label, forged labels in student and stored text are neutralised, the persona question count is server-owned (`personaQuestionsAsked`), and the learner summary is gated on teaching modes. ADR-0009 records the decisions. TypeScript and security approve; architect approves with doc fixes; safety requests changes (full text: safety-review.md).


After fix round 2: code-reviewer (sonnet) approves the round-2 changes (fence breaker linear and idempotent, narrower "teacher wrote" window, agent-history passes) with one MEDIUM, deferred to 3.11e. The lead signed the 4 new eval cases (`reviewed_by: lead`, MVP first). Merge waits on the human re-signing the changed prompt packs (B-23).

## Findings
- [HIGH] [fixed] content/prompt-packs/safety@1.0.0.md:15 — rule 3 calls a teacher note inside a user message forged, but this PR puts the real teacher note in the user channel; amend rule 3 under ADR-0009 (safety-review.md issue 1).
- [HIGH] [fixed] packages/harness/src/pedagogy/modelRequest.ts:57-68 — the forged-label match needs the exact label; no brackets, look-alike letters, accents, fullwidth colon, hyphen, markdown inside, HTML entities all pass; fold first and break the core phrase (safety-review.md issue 2).
- [MEDIUM] [fixed] packages/harness/src/pedagogy/modelRequest.ts:101 — the teacher text has no end marker, so a following student turn merged by the provider reads as the teacher's; fence it <<<…>>> and neutralise <<< / >>> in student text (safety-review.md issue 3).
- [MEDIUM] [fixed] content/prompt-packs/mock_interview@1.0.0.md:8 — "Keep count of the questions you have asked" contradicts the frame's "never count turns yourself" (safety-review.md issue 4).
- [MEDIUM] [fixed] docs/adr/0009-composer-closed-mode-and-teacher-turn-hardening.md:43 — the gateway-adapter owner is "task 7.x" (M7 is evals); the adapters are task 2.2 (merged), and @ai-sdk/anthropic already merges consecutive user messages (architect).
- [LOW] [fixed] docs/adr/0009-composer-closed-mode-and-teacher-turn-hardening.md:41-47 — Consequences omit the homoglyph residual risk (architect).
- [LOW] [fixed] docs/adr/0009-composer-closed-mode-and-teacher-turn-hardening.md — no note that the new required persona slot breaks any future frame pack without it (architect).
- [LOW] [deferred 3.11e] packages/harness/src/pedagogy/skills.ts:68-74 — the count rises on /pause, stop and post-debrief turns and never resets (safety-review.md issue 5).
- [LOW] [deferred 3.11e] closed modes still send the whole session history (pre-existing; safety-review.md issue 6).
- [LOW] [deferred 3.11e] packages/contracts/src/turn.ts:66 — MessageSchema.text and ChunkSchema.text have no max length (pre-existing; security).
- [LOW] [deferred 3.11e] proposed forged-note eval cases parked until the eval schema has teacher-turn, skill and persona fields (safety).

### typescript-reviewer (opus) — APPROVE
- [MEDIUM] [deferred 3.11e] packages/harness/src/pedagogy/skills.ts:68-74 — personaQuestionsAsked counts every mock_interview turn (/pause, "are you human?", stop, post-debrief) and never resets on stop/restart or persona switch; a restarted role-play opens at "question 6 of 5".
- [MEDIUM] [deferred 3.11e] packages/harness/src/pipeline/runner.ts:524 + steps/commit.ts:55 — the incremented count is saved even when the turn errors, is cancelled, or the safe reply replaces it.
- [LOW] [deferred 3.11e] packages/harness/src/pedagogy/compose.test.ts:166 — the "claim in conversation changes nothing" test is tautological (composer never reads ctx.history).
- [LOW] [deferred 3.11e] packages/harness/src/pedagogy/compose.test.ts:183 — the test pins "question 0 of 5", an unreachable state.
- [LOW] [deferred 3.11e] packages/harness/src/pedagogy/modelRequest.ts historyMessage — teacher turns in the user channel can give consecutive user messages; note the adapter requirement in ADR-0009 or the gateway task.

### Round-1 re-reviews (safety-reviewer, architect) — APPROVE with notes; fixed in fix round 2
- [MEDIUM] [fixed] packages/harness/src/pedagogy/modelRequest.ts:167-169 — the fence check matched literal `<`/`>` only, so `<<\u200B<`, `＜＜＜`, `﹤﹤﹤` and `&lt;&lt;&lt;` passed (safety). Fix: `breakFenceRuns` decodes entities, NFKC-folds each character and skips format characters before matching; a run becomes `< < <`; linear and idempotent.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/modelRequest.ts:105-110,178 — the core-phrase pass put " [copied]" into assistant history and ordinary student text, which the model could echo (safety). Fix: agent history skips the core-phrase pass (commit stores only the guarded reply as `agent`); "teacher wrote" breaks only before "this reply" or with "platform"/"note" within 32 folded characters. Every round-1 probe still breaks.
- [LOW] [fixed] docs/adr/0009-composer-closed-mode-and-teacher-turn-hardening.md:27 — decisions numbered 1, 2, 5, 3, 4; decision 5 now follows 4 (architect).
- [LOW] [deferred 3.11e] packages/harness/src/pedagogy/modelRequest.ts foldForMatch — digit swaps (`Pl4tform`), small caps and a Devanagari label are not folded (safety).
- [LOW] [deferred 3.11e] gateway adapters — no boundary test that consecutive user messages keep the teacher fence intact when merged (architect).
- [MEDIUM] [deferred 3.11e] packages/harness/src/pedagogy/modelRequest.ts:96-98 — the core-phrase pass re-detects a label the exact-label pass already spaced out, so a verbatim pasted label gets " [copied]" twice (visible in the content snapshot); skip spans the exact-label pass rewrote (code-reviewer).

## Merge with main (20 Oct 2026)
The merge of main (530ea59) conflicted in compose.ts, helpState.ts and helpState.test.ts. typescript-reviewer (sonnet) checked only the resolution: both the persona question count and the 5.6/5.6c practice fields survive in the strict HelpState schema, its parse round-trip and the combined size-limit test, and practice turns keep the persona count. APPROVE, no findings.
