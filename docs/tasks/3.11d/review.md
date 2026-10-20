# 3.11d review — CHANGES (fix round 1 pending)
Reviewers: safety-reviewer (opus), architect (opus), typescript-reviewer (opus), security-reviewer (sonnet)

Teacher turns move to the user channel under a platform label, forged labels in student and stored text are neutralised, the persona question count is server-owned (`personaQuestionsAsked`), and the learner summary is gated on teaching modes. ADR-0009 records the decisions. TypeScript and security approve; architect approves with doc fixes; safety requests changes (full text: safety-review.md).

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
