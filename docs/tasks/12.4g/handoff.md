# 12.4g handoff: staff agents view takes the whole reloaded record

**Status:** DONE
**Branch:** m13/12.4g-agents-reload
**Worktree:** .claude/worktrees/agent-a11fba3b2a9a6f03f

## What changed
- `apps/web/app/staff/agents/view.tsx`: after a successful approve or revoke, `onSetApproval` now replaces the row with the whole fresh record from the reload, instead of merging only `approvedAt`, `approvedBy` and `regulatedSubject`. So `status`, `liveVersion` and `teacherSlug` no longer stay stale. The fallback when the reload fails (or the agent is missing from it) is unchanged.
- `apps/web/app/staff/agents/view.test.tsx`: two new tests (written first, seen failing): after approve and after revoke, the row shows the reloaded status and teacher slug and the reloaded approval state. `liveVersion` is not rendered by `AgentRow`, so it is covered by the whole-record replace rather than a DOM assertion.

## Evidence
- Red: `corepack pnpm vitest run app/staff/agents/view.test.tsx` → `Tests 2 failed | 23 passed (25)` (the two new tests).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → exit 0; `Test Files 143 passed | 4 skipped (147)`; `Tests 2168 passed | 25 skipped (2193)`; `Tasks: 10 successful, 10 total`.
- `python3 .githooks/secret-scan.py --all` → clean (exit 0).

## Decisions
None.

## Left to do
None.

Tool calls used: 27 (harness count: builder 27; the agent reported 14)
