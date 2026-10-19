# 4.6 review — APPROVE
Reviewers: safety-reviewer (opus), architect (sonnet), security-reviewer (sonnet; also covered silent failures), typescript-reviewer (sonnet)

A safety plan review and an architect plan review came before the build; the boolean-only port and whole-reply replacement were a lead decision. All three build reviewers approved:
- 34/34 locked cases end in the locked reply across 351 scripted runs;
- both mutations fail 34/34;
- locked text never reaches a model, log, trace or error;
- the complement scope is built server-side;
- every call site fails closed.

Contracts 325, harness 3,079 and evals 300 tests pass; the ADR and secret checks are clean. The lead updated the build plan's guard table to the new order and action (the architect's MEDIUM).


typescript-reviewer reviewed the contracts change on its own (the gate requires it for contracts): the signature is pinned by type tests, the strict zod result schema sits at the call site, there are no unsound casts, and the in-memory adapter implements the port exactly. APPROVE.

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
- [LOW] [deferred 4.6b] packages/contracts/src/ports.ts:39 — `candidates: string[]` could be `readonly string[]`, and the scope shape could be a shared type alias; both match the existing port style.

## 4.6b review — APPROVE
Reviewers: architect (sonnet), security-reviewer (sonnet), typescript-reviewer (sonnet), safety-reviewer (opus)

The seven 4.6 deferrals were built. Architect and security approved first time; typescript-reviewer and safety-reviewer requested changes; fix round 1 fixed them, and both re-verified and approved. Full run 37/37 tasks (harness 3,226, contracts 325, evals 300), ADR and secret checks clean.

### Findings
- [CRITICAL] [fixed] packages/harness/src/guardrails/lockedMatch.ts:40 — the tag stripper blanked everything inside a tag's attributes, so one tag-shaped wrapper hid any locked prose from both checks. Replaced by three markup readings (text, values, rendered), all tried; a linear hand-written scanner. (typescript-reviewer)
- [HIGH] [fixed] packages/harness/src/pipeline/generate/lockedStream.ts:90 — under holdAll every batch re-sent the whole reply (quadratic). Now one whole-reply check at release(). (typescript-reviewer; security-reviewer rated it MEDIUM)
- [HIGH] [fixed] packages/harness/src/pipeline/runner.ts:517 — the session stop was saved only on the replied path and only for stream trips; cancel, provider error, escalate or a post-guard-only hit left it false. Trips are now latched from every source and forced into every saved state. (safety-reviewer)
- [HIGH] [fixed] packages/harness/src/pedagogy/skills.ts:122, pipeline/policies.ts:93 — a correct practice answer, a fallback context or an unreadable blob cleared the stop. The runner owns it (loaded || tripped); an unreadable help state runs holdAll and saves nothing (lead decision). (safety-reviewer)
- [MEDIUM] [fixed] lockedStream.ts:107 — held text could start inside an unfinished tag or entity; it now starts 7 tokens before it.
- [MEDIUM] [fixed] lockedMatch.ts:43 — tags inside words split them; markup is padded with zero-width.
- [MEDIUM] [fixed] docs/adr/0007-locked-leak-check-port.md:38 — §8 rewritten in place and overstated; original kept with a dated amendment (per-session bound: daily limit × about log2(N+1) bits; no 2+-token run streams; once per batch). (architect, safety-reviewer)
- [MEDIUM] [fixed] packages/harness/src/pedagogy/helpState.ts:24 — lockedStopped was required, so every older stored state reset to rung 0; now optional.
- [MEDIUM] [deferred 4.6c] lockedMatch.ts:43 — markdown emphasis inside words (l**o**p) is not caught.
- [MEDIUM] [deferred] helpState.ts — the help-state blob is one flat strict object that several tasks extend; give new fields defaults on read and consider per-feature namespaces before 3.11d. (architect)
- [LOW] [fixed] lockedMatch.ts:16 — confusables table extended; known-miss list extended.
- [LOW] [deferred 4.6c] lockedMatch.ts:93 — parser and browser disagree on some tag shapes; known misses, and the chat never renders raw model HTML (9.4).
- [LOW] [deferred 4.6c] runner.ts:873 — a failed or timed-out post-guard step does not count as a trip.
- [LOW] [deferred 4.6c] helpState.ts:98 — a corrupt stored blob is never reported.
