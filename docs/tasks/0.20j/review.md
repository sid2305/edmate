# Review: 0.20j — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

typescript-reviewer re-checked fix round 2.

## Findings
- [HIGH] [fixed] apps/web/instrumentation.ts:36 — `require('./instrumentation.node')` returned `any`, so `.runNodeStartup()` was unchecked. Fix round 2 casts it to the module's type through an erased `import type`, keeping the literal require token Next needs; a renamed call now fails typecheck (TS2551).
- [MEDIUM] [fixed] apps/web/vitest.config.ts — `coverage.include` now lists instrumentation.node.ts, which holds the moved startup logic.
- [LOW] [wontfix] apps/web/next.config.ts — the plan listed this file as out of bounds; the lead's fix-round-1 brief widened scope to add `devIndicators: false` (lead decision).
- [LOW] [wontfix] apps/web/instrumentation.ts — a synchronous throw from the require is not caught; a missing build artifact should stop startup loudly (lead decision).
- [LOW] [deferred 0.20k] apps/web/e2e/teacher-packages-walkthrough.spec.ts — one of 6 runs timed out on the Save button in the reuse/edit path (no intercepted click); 5 later runs passed.

## Notes
- runNodeStartup is a verbatim move of the old register() body, so Node still does the same warm-up and Edge never reaches it. Tests cover nodejs, unset and edge.
- The guard now skips only `edge`, so an unset NEXT_RUNTIME runs Node startup. That matches Next's documented shape and has a test.
- After fix round 2, the production build log has no Edge-runtime warning about Node modules.
