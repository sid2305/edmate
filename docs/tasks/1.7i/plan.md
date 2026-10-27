# 1.7i plan — build-smoke cleanup assigned before createSession

**Lead-written plan (26 Oct 2026).** Small, fully specified, test-only.

## Problem
`apps/web/test/build-smoke.test.ts` (the `beforeAll` near line 175) calls `identity.createStudent`, then
`identity.createSession`, and only then assigns `eraseStudent`. If `createSession` throws, the student row
leaks on the shared dev Postgres (1.7d code-reviewer MEDIUM).

## Change
1. Move the `await identity.createSession(SID, user.id, ...)` line so it runs **after** the `eraseStudent = async () => {...}`
   assignment (keep the 1.7d comment block with the assignment). Nothing else in the block changes.
2. Add one short comment line saying the cleanup is assigned before any later step that can throw.

No other file changes besides `docs/tasks/1.7i/handoff.md`. No risky paths.

## Tests
Code-path change only: the existing `afterAll` already calls `eraseStudent` when set. A dedicated failing-createSession
test would need to mock the identity store inside a real-build smoke test, which is out of proportion; the handoff
records the code path as the evidence (the task's `accept` allows "a clear code path").

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` (output to a file, grep it). The build-smoke test
runs only when its env is set; note in the handoff whether it ran or skipped. Then `python3 .githooks/secret-scan.py --all`.

## Budget
Budget: 15 tool calls.
