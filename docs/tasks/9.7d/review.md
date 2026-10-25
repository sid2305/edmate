# 9.7d review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both Sonnet reviewers approved. `postOnce`, `SEND_PATH` and `STEP_TIMEOUT` moved verbatim from `full-flow.spec.ts` into `fixtures.ts`; `chat.spec.ts`'s sends and its "Get a hint" click now go through `postOnce`, and `full-flow.spec.ts`'s `toHaveCount(0)` takes `STEP_TIMEOUT` (the 9.7b LOW). No assertion text or expected value changed. The typescript-reviewer's one MEDIUM is inherited from the already-shipped `postOnce` and is deferred to a board task.

## Findings
- [MEDIUM] [deferred 9.7e] apps/web/e2e/fixtures.ts:39 — `postOnce` re-runs `act()` if a real post-hydration request takes longer than the inner 2s poll to register, which would double-send; `mockTurns` clamps on overflow and no test counts requests, so a double-send would pass silently. Inherited verbatim from `full-flow.spec.ts`; 9.7d only moves it and adds call sites.
