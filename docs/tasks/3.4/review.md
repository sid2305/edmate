# 3.4 review — APPROVE
Reviewers: security-reviewer (opus), typescript-reviewer (sonnet)

security-reviewer confirmed retrieval is scoped to allowedModuleIds, the probe is reduced to hit/score, the assemble-time TurnContext check holds, and the help state stays out of TurnContext and the trace. typescript-reviewer re-ran the harness gates uncached (2,000 tests, 100% coverage on new files) and confirmed a deterministic trim with boundary cases, the unchanged step interface, help-state round-trip and fallback, a scope-guarded RetrievalIndex fake, harness purity, and a test that `answerKey` and locked text never appear in TurnContext, events or the trace.

## Findings
- [LOW] [deferred 3.16] packages/harness/src/pipeline/steps/buildContext.ts:62 — history, source titles and last summary are reused when a student's package lapses mid-session; sessions must end or re-scope when the package changes.
- [LOW] [deferred 3.8] packages/harness/src/pipeline/runner.ts:569 — `CommitRecord.entitled` carries the raw help state including `answerKey`; commit (3.8) must never copy it into a transcript or event.
