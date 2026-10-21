# 5.8 review — APPROVE

Reviewers: architect (opus), security-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (opus)

The ADR-0013 drafts were reviewed by security-reviewer (sonnet) and typescript-reviewer (opus). The final branch was reviewed by architect (opus), security-reviewer (sonnet), code-reviewer (sonnet) and typescript-reviewer (opus). Fix round 1 was verified by typescript-reviewer (opus) at 9b43c98: all four fixes verified; harness 5217, evals 1005 and content 503 tests pass.

## Findings
- [HIGH] [fixed] docs/adr/0013-roleplay-state.md — the Rollback consequence was wrong (an unreadable blob is never saved over); restated: rollback is free until the 5.8a wiring, then needs a migration that strips `personaPhase`.
- [MEDIUM] [fixed] docs/adr/0013-roleplay-state.md — persona id stored without version; recorded as accepted (all live versions human-signed).
- [MEDIUM] [fixed] docs/adr/0013-roleplay-state.md §1 — `RolePlay` is a union keyed on phase with a `Record<phase, section>` map.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/policy.ts — `finish` passes `rolePlay` through, with a test.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/roleplay.ts — numbers clamped (`total = M'`, `N = clamp(before, 1, M')`, `answered = clamp(before - 1, 0, M')`), one test per clamp.
- [MEDIUM] [fixed] docs/adr/0013-roleplay-state.md §5 — the post-stop count change listed next to the resume fix; legacy-frame sequence test added.
- [MEDIUM] [fixed] docs/adr/0013-roleplay-state.md §4 — debrief grounding stated; question 7 sent to the human (B-37).
- [MEDIUM] [fixed] packages/harness/src/pedagogy/policy.ts — `rolePlayStep` runs before the coverage gate (lead default q6) and is handed into `skillStep`.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/compose.ts — role-play turn keyed on `policy.reason === 'mock_interview'`; closed moves tested with a persona.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/policy.ts:96 — a bare `stop` or `/pause` routed meta or off_topic was redirected and never changed the phase; control now goes before the intent redirect, after distress, entitlement and misuse, with non-on_task tests.
- [MEDIUM] [fixed] packages/evals/src/rolePlayFixtures.test.ts:125 — hand copy of `rolePlayControl`; now exported from the harness and imported.
- [MEDIUM] [fixed] packages/evals/src/rolePlayFixtures.test.ts:276 — the are-you-human turn is also replayed with its `meta` label; judge line 1 of the case loosened by the lead to match the real redirect.
- [MEDIUM] [deferred 5.8b] packages/harness/src/pedagogy/roleplay.ts:42 — the coverage gate is skipped on `ended` turns and on `/pause` with any text (B-37 q8).
- [MEDIUM] [deferred 5.8b] docs/adr/0013-roleplay-state.md:65 — uneven gate rule on answer turns; personal answers can reach the teacher inbox (B-37 q9).
- [MEDIUM] [deferred 5.8b] packages/harness/src/pedagogy/policy.ts:103 — `/pause` followed by other text also skips the off_topic/meta redirect (B-37 q8).
- [LOW] [fixed] packages/content/src/personaTemplates.ts:128 — a blank `reviewed_by` counted as signed; now `z.string().trim().min(1)`.
- [LOW] [fixed] docs/tasks/5.8/handoff.md:186 — fix-round decisions were outside `## Decisions`; consolidated by the lead.
- [LOW] [deferred 5.8b] packages/harness/src/pedagogy/roleplay.ts:43 — `question === 1` gate skip; skills.ts:90 step/persona assert; typed `PersonaTemplateError`; compose sub-threshold chunks; prerelease selection; ADR rollback note and status.
- [LOW] [wontfix] packages/harness/src/pedagogy/compose.ts:182 — legacy M not clamped to PERSONA_QUESTIONS_MAX (kept byte-identical; noted in ADR §5).
- [LOW] [wontfix] packages/harness/src/pedagogy/compose.ts — `rolePlayTurn` also checks `mode === 'mock_interview'`; a no-op given `composeMode`.
