# 8.5b review — APPROVE

Reviewers: code-reviewer (opus), typescript-reviewer (sonnet), security-reviewer (sonnet), lead

The code reviewer re-ran `turbo run typecheck lint test --filter=@edmate/web`: 10/10 tasks green, 971 tests, route coverage passes. A preview turn runs the same `runTurn(defaultSteps)`, `sseBody`, body cap and guard ports as a student turn; only the entitlement source changes to `teacher_preview`. The scope always comes from the signed-in teacher, the package comes from the session row, and cross-teacher, cross-agent and spoofed-field requests are 404 or 400 with no writes.

## Findings
- [MEDIUM] [deferred 8.5d] apps/web/src/studio/testChat/deps.ts — preview reuses the student write ports, so an `ask_teacher` or grounding escalation in a preview lands in the teacher's own Ask-the-teacher inbox, and profile, evidence and safety-event rows are written for the (teacher, teacher) pair.
- [LOW] [deferred 8.5d] apps/web/src/studio/testChat/routes.ts — `readJson` and `configuredMarket` are copied from `src/turn/` (a logged decision); export them from `src/turn` once that path is free.
- [LOW] [deferred 8.5d] apps/web/src/studio/testChat/routes.test.ts — route tests build `depsFor` by hand; add one route test through `testChatDepsFor` over memory repos that checks the usage ledger's `source = teacher_preview`.
- [LOW] [deferred 8.5d] apps/web/src/studio/testChat/routes.ts — `postCorrection` builds the teacher scope as an object literal rather than through the `teacherScope()` helper (the repo re-validates it), and the shared `Id` schema serves both agent and module ids.
- [LOW] [deferred 8.5d] apps/web/src/studio/testChat/routes.ts — `CorrectionSchema` text fields have no per-field max; the 64 KB body cap and the repo's `invalid` check bound them today.
