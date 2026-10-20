# 3.10 review — APPROVE
Reviewers: architect (opus), security-reviewer (sonnet), typescript-reviewer (sonnet), safety-reviewer (opus), code-reviewer (sonnet)

Two fix rounds. Round 1 closed the security HIGH (unrolled ambiguous alternation passed the structural check) and the architect's ADR-0008 wording. Round 2 closed the TypeScript re-review's two HIGHs, its MEDIUM and LOW, and the architect's overclaim MEDIUM. The TypeScript and architect re-checks of round 2 approve; code-reviewer found nothing new. CI on PR #57 is green; the real `content/locales` directory fails validation on purpose until the human signs the IN pack (B-20).

## Findings
- [HIGH] [fixed] packages/content/src/safeRegex.ts — a manually unrolled ambiguous alternation (`(x|xx)` ×25 then `z`) passed the structural check and took seconds; `unrolledOverlap` refuses adjacent overlapping groups, the probe derives units from the pattern, and a worker wall-clock ceiling guards the load path (round 1). Re-verified by security-reviewer.
- [HIGH] [fixed] packages/content/src/safeRegexGuard.ts — no `'error'` listener on the spawned worker could crash the host process; listener added (round 2). Re-verified by typescript-reviewer.
- [HIGH] [fixed] packages/content/src/safeRegexGuard.ts — no test ran the real Worker/Atomics/MessagePort protocol; `safeRegexGuardIntegration.test.ts` added (round 2). Re-verified by typescript-reviewer.
- [MEDIUM] [fixed] packages/content/src/safeRegex.ts — `{1}`, one-branch groups and empty terms bypassed `unrolledOverlap` (round 2). Re-verified by typescript-reviewer.
- [MEDIUM] [fixed] docs/adr/0008-locale-pack-verification.md — overclaimed the structural check as a proof; reworded, fallback and strictness documented (rounds 1–2). Re-verified by architect.
- [LOW] [fixed] packages/content/src/safeRegexGuard.ts — `received.message as string[]` replaced with a runtime shape check (round 2).
- [MEDIUM] [deferred 3.10a] packages/content/src/safeRegexGuardIntegration.test.ts:30 — `beforeAll` runs `tsc` into the shared `dist` while `@edmate/content#build` can run at the same time in CI; give the test its own outDir or make `test` depend on `build`.
- [MEDIUM] [deferred 3.10a] packages/content/src/safeRegexGuard.ts — a missing compiled worker file falls back in-process with no ceiling; outside tests it should fail closed, plus a CLI smoke test of `edmate content validate` on built output.
- [LOW] [deferred 3.10a] packages/content/src/safeRegex.ts — `a?`×25 then `a`×25 (no group) is left to the timing probe and the ceiling, by design (the real IN mobile pattern has the same shape).
