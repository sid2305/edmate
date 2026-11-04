# Review: 4.7b — APPROVE

Reviewers: code-reviewer

## Findings
- [CRITICAL] [fixed] packages/harness/src/pipeline/runner.ts — the Phase D session queue was keyed on the per-call `PipelineDeps` object, which apps/web's `turnDepsFor` rebuilds every turn, so concurrent same-session turns were never serialised in production; now a required `PipelineDeps.turnQueue` built once per process, with a test using a fresh `PipelineDeps` per turn.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/citations.ts — bare "source N" matched ordinary prose ("the light source 2 meters away"); now needs a citation cue.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/numbers.ts — CLAIM_BEFORE read "pay 15 for 3 + 4 tickets" as a wrong claim; now needs a claim cue word and a clause-ending "for".

## Notes
- code-reviewer ran twice: once on Phases A to C, once on Phase D. Both reproduced the harness gate green.
- The lead verified both fix rounds from the diff. For the Phase D fix, the lead checked every `createSessionTurnQueue()` call site: apps/web's turn runtime and studio test-chat runtime build it inside their memoised process `build()`, the CLI once per chat process, and the worker once per gate agent.
- Safety paths (`guardrails/**`) reviewed by code-reviewer only, per the MVP-first rule (no safety-reviewer per PR until 13.3); the lead logged a risk: high decision.
