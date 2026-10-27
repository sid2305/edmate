# Review: 0.20h — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

## Findings
- [HIGH] [deferred 0.20j] docs/tasks/0.20h/handoff.md — the at-cap rename path in teacher-packages-walkthrough.spec.ts (`createOrRenamePackage`) never ran to completion locally: a separate dev overlay bug hangs the Save click. This is a verification gap, not a code defect. The below-cap create path is unchanged and runs in this PR's CI e2e job on a fresh database. 0.20j fixes the overlay bug and its accept line needs 5 fresh local passes of this spec, which exercises the at-cap path.
- [MEDIUM] [deferred 0.20j] apps/web/e2e/global-setup.ts:56 — the comment says `WARM_UP_TIMEOUT_MS = 60_000` is "comfortably under" `webServer.timeout` (60 s), but the two are equal and run one after the other, not nested. Harmless, because the warm-up is best effort and non-fatal. 0.20j corrects the comment (or lowers the value to about 30 s).

## Notes
- Both reviewers checked that the rename path only touches this file's own `E2E Starter ` / `E2E Full ` packages and uses PUT (no new rows). The count is read after the list has finished loading. `displayName` comes from the same `coalesce` the page renders. The warm-up `Promise.all` cannot reject.
