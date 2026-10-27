# Handoff: 6.5b

Status: DONE

## Summary

Closed the three 6.5 review LOWs, apps/web only, no `packages/db` or `packages/contracts` change.

1. `apps/web/app/learn/[agentId]/memory/page.tsx` now resolves its scope through the same
   `studentTurnScope` helper `apps/web/src/memory/routes.ts` already uses, instead of hand-building
   `{ studentId, teacherId }` from a separate `repos.agents.owner()` call. Replaced:
   ```
   const owner = await repos.agents.owner({ agentId });
   if (owner === null) return notFound();
   const scope = { studentId: principal.userId, teacherId: owner.teacherId };
   ```
   with:
   ```
   const scope = await studentTurnScope(repos.agents, principal, agentId);
   if (scope === null) return notFound();
   ```
2. `apps/web/src/memory/routes.test.ts`: new `describe('memoryHandlers (the wired export, over a
   mocked serverDatabase)')` block, mocking `../auth`'s `serverDatabase()` via `vi.hoisted`
   (following `studio/runtime.test.ts`'s pattern). Exercises the real wired `memoryHandlers.export`
   and `memoryHandlers.reset` (not just `createMemoryHandlers(backend)`), asserting the resolved
   scope reaches `agents.owner`, `learnerProfiles.get`/`reset` and `evidenceEvents.list` (with
   `{ limit: EVIDENCE_LIST_MAX }`), and the 200 response shapes.
3. Documentation: `apps/web/app/api/me/memory/[agentId]/route.ts`'s top comment gained one
   sentence; `apps/web/src/memory/routes.ts`'s `reset` handler gained a fuller comment. Both state
   that `learnerProfiles.reset` ends the pair's open sessions before it checks whether a profile
   row exists, so `{ reset: false }` means "nothing to clear" (no mastery/evidence), not "nothing
   happened" -- matching 6.5a's precedent wording. Comment-only; no response-shape change.

### Red-then-green evidence
- Step 1 (wiring test meaningful before any other edit): added the new `describe` block against
  the *unmodified* `routes.ts`/`page.tsx`; ran `vitest run src/memory/routes.test.ts` alone --
  12 tests passed (10 existing + 2 new), confirming the wiring itself was already correct, only
  untested.
- Step 2 (page refactor, no behaviour change): after editing `page.tsx`, ran
  `vitest run -t MemoryPage` (matches `app/learn/[agentId]/memory/page.test.tsx`) unmodified --
  4/4 passed with no test edits: `owner` still called with `{ agentId }`, `get` still called with
  `{ studentId: 'std_amy', teacherId: 'tch_asha' }`, non-live gives `notFound`, guard refusal reads
  no database.
- Step 3: full gate green (below), no regression in the existing `routes.test.ts` factory-level
  tests.

The known-flaky `apps/web/src/auth/index.guard-only.test.ts` passed on its only run (1/1), so no
second run was needed.

## Decisions

### 27 Oct 2026 · 6.5b budget overrun accepted · decided by lead · risk: low
- Decided: accept 44 tool calls against the plan's budget of 35 (1.26x).
- Why: one phase, three approving reviews with no findings, and the extra calls went on prettier passes and on running the web gate; no scope was added.

### 27 Oct 2026 · 6.5b review and risk level · decided by lead · risk: low
- Decided: merge with code-reviewer, typescript-reviewer and security-reviewer, all APPROVE with no findings; no `risk: high` entry, since no changed path matches `risk-paths.txt`.
- Why: the page's scope resolution is an access check, so security-reviewer ran anyway; it confirmed the page and the route now refuse the same cases with no database read before the guard.

### 27 Oct 2026 · 6.5b closes the three 6.5 review LOWs · decided by builder · risk: low
- Decided: the memory page now resolves its scope through the same `studentTurnScope` helper the
  route uses, instead of a second hand-built scope object; a new test exercises the real wired
  `memoryHandlers` export (not just the factory) against a mocked `serverDatabase()`; code
  comments on both the route file and `routes.ts`'s `reset` handler document that a reset with no
  profile row still ends any open session.
- Why: closes three LOW findings from the 6.5 review with no behaviour change -- same scope
  values, same responses, same `packages/db` contract. No risky-path match per
  `.claude/skills/merge-gate/risk-paths.txt` (`apps/web/app/learn/**` and `apps/web/src/memory/**`
  are not listed groups); the board's `risk: risky` tag reflects that this task closes out LOWs on
  6.5 itself (which was `risk: high`), not a new risky-path touch here. No `risk: high` decision
  needed. Lead-recommended reviewers: code-reviewer, typescript-reviewer, and security-reviewer
  (page's scope resolution is an access check, even though not glob-matched).

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` -- 10/10 tasks successful
  (typecheck, lint, test across all apps/web + its deps); @edmate/web:test green with no
  regressions.
- `corepack pnpm exec prettier --check` on the four changed files
  (`apps/web/app/api/me/memory/[agentId]/route.ts`, `apps/web/app/learn/[agentId]/memory/page.tsx`,
  `apps/web/src/memory/routes.ts`, `apps/web/src/memory/routes.test.ts`) -- all four pass (ran from
  within each bracket-path directory to avoid shell globbing; `routes.ts`/`routes.test.ts` needed
  one `--write` pass after editing, then re-checked clean).
- `python3 .githooks/secret-scan.py --all` -- clean, no findings.
- `git diff origin/main -- packages/contracts packages/db` -- empty (no contracts/db change, per
  the plan's exit conditions).

## Budget
Tool calls used: 44 (harness count; the builder reported 28)
