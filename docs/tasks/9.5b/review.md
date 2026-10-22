# 9.5b review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings

- [HIGH] [fixed] apps/web/src/chat/ChatView.tsx — a locked mock-interview start left `activeSkill` stuck at `mock_interview`, so Pause/Stop showed for an interview that never started and every later message was tagged and locked. Fix 1cd9c01 clears `activeSkill` on any locked reply, with tests for mock-interview and practice; typescript-reviewer re-verified (26/26 ChatView tests pass).
- [LOW] [deferred 9.5c] apps/web/src/chat/SkillLauncher.tsx — the persona buttons have no labelled group for screen readers.
- [LOW] [deferred 9.5c] apps/web/e2e/skills.spec.ts — the new e2e cases were not run locally (no compose Postgres in the builder's worktree); they run once CI runs e2e.
