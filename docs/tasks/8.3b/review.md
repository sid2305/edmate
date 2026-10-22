# 8.3b review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [HIGH] [fixed] apps/web/src/studio/runtime.ts — the backend factory cached the awaited backend, so concurrent cold requests built several backends; now caches the in-flight promise and clears it on failure (test: two concurrent calls build once). Verified by the lead.
- [MEDIUM] [deferred 8.3d] apps/web/src/studio/outline.ts — moduleInputs reads each module's chunks one by one; use Promise.all.
- [MEDIUM] [fixed] apps/web/src/studio/index.ts — edited although reserved for 8.4a; main merged and both export sets kept, tests green.
- [LOW] [deferred 8.3d] apps/web/src/studio/outline.ts — `body as OutlineInput` after a re-declared zod schema; reuse the db package's schema.
- [LOW] [wontfix] apps/web/src/studio/outline.ts — OutlineBackend is its own interface joined with StudioBackend in runtime.ts rather than extending it; equivalent, and avoids editing routes.ts.
