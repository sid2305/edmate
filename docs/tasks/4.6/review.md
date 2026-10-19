# 4.6 review — APPROVE
Reviewers: safety-reviewer (opus), architect (sonnet), security-reviewer (sonnet; also covered typescript and silent failures)

A safety plan review and an architect plan review came before the build; the boolean-only port and whole-reply replacement were a lead decision. All three build reviewers approved:
- 34/34 locked cases end in the locked reply across 351 scripted runs;
- both mutations fail 34/34;
- locked text never reaches a model, log, trace or error;
- the complement scope is built server-side;
- every call site fails closed.

Contracts 325, harness 3,079 and evals 300 tests pass; the ADR and secret checks are clean. The lead updated the build plan's guard table to the new order and action (the architect's MEDIUM).

## Findings
- [MEDIUM] [fixed] docs/edmate-harness-build-plan.md:425 — the guard table listed the old order and a surgical rewrite. Updated to lockedLeak-first with whole-reply replacement (ADR-0007).
- [MEDIUM] [deferred 4.6b] packages/harness/src/pipeline/generate/lockedStream.ts:72 — up to 7 locked tokens can flash before the replace. Hold the last 7 checked tokens until the next sentence passes.
- [MEDIUM] [deferred 4.6b] docs/adr/0007-locked-leak-check-port.md:38 — the stop position leaks about log2(N+1) bits per turn. After the first locked hit in a session, stop streaming for the rest of the session; fix the ADR wording.
- [MEDIUM] [deferred 4.6b] packages/harness/src/pipeline/generate/lockedStream.ts:57 — one port call per sentence; batch the released sentences.
- [MEDIUM] [deferred 4.6b] packages/harness/src/guardrails/lockedMatch.ts:39 — HTML tags and entities and homoglyph spans get past; strip and fold first.
- [MEDIUM] [deferred 5.3] docs/board/tasks.yaml:996 — the production RetrievalIndex has no leakCheck yet; 5.3's accept line now carries its contract tests.
- [MEDIUM] [deferred 4.6b] packages/harness/src/testing/virtualClock.ts:13 — FLUSH_TURNS 2000 is a magic number; flush until quiet, or pin the worst-case chain length.
- [LOW] [deferred 4.6b] packages/harness/src/guardrails/lockedMatch.test.ts:1 — no performance guard at the 8,000-character cap.
- [LOW] [wontfix] packages/harness/src/pipeline/steps/postGuard.ts:193 — a locked-check outage gives the generic safe reply, not the locked reply; consistent with the stream path. See the 4.6 decision.
