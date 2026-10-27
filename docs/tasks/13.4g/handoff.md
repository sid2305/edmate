# 13.4g handoff: export dedupe tie-break, parseConsentRow error contract

Status: DONE

## Summary

Closes the two findings deferred from docs/tasks/13.4f/review.md.

- `apps/web/src/export/accountExport.ts`: replaced the strict `pair.periodEnd > existing.periodEnd`
  dedupe test with a local comparator `newer(a, b)`. On a tie, a non-`'ended'` row beats an
  `'ended'` one; if both still tie, the smaller `status` string wins, so the kept row no longer
  depends on the order `listAllForStudent` returns rows in. Updated the comment above the dedupe
  loop to describe the order. No change to `SubscriptionPair`, `TEACHER_PAIRS_MAX`, or the backend
  interface.
- `apps/web/src/export/accountExport.test.ts`: added two new cases for the exact-`periodEnd` tie
  (`'ended'` row first, then `'active'` row first) — both assert the kept `teachers` entry is the
  active one, regardless of input order.
- `packages/db/src/identity/store.ts`: doc-comment only, on `parseConsentRow`. Documents that it
  throws the raw `ZodError` on a bad `grantedBy`; the only in-file caller runs behind `guarded`
  (via `guardAll`), which scrubs it; any other caller must do the same or treat the throw as a
  programming error. No code change.

## Decisions

### 26 Oct 2026 · 13.4g budget overrun (29 vs 20) · decided by lead · risk: low
- Decided: accept 29 tool calls against the 20 budget (1.45x).
- Why: a background-task wait and a commit retry; the change itself stayed inside the plan's three files, and all three reviewers approved with no findings.

### 26 Oct 2026 · 13.4g tie-break final key · decided by builder · risk: low
- Decided: when `periodEnd` and the ended/non-ended split both tie, break the remaining tie by
  the smaller `status` string (not, say, insertion order or `agentId`).
- Why: the plan specifies this exact order ("the smaller `${status}` string wins"); using a plain
  string field keeps the comparator pure and independent of array position, matching the acceptance
  criterion that the result doesn't depend on `listAllForStudent`'s row order.

### 26 Oct 2026 · 13.4g identity doc-comment on parseConsentRow · decided by builder · risk: high
- Decided: added a doc-comment-only error-contract note to `packages/db/src/identity/store.ts`
  (risky path per `.claude/skills/merge-gate/risk-paths.txt`); no runtime behaviour changed.
- Why: the plan calls for documenting (not changing) `parseConsentRow`'s throw behaviour so future
  callers outside the guarded store methods know to scrub the error themselves; flagged `risk: high`
  because `packages/db/src/identity/**` is a risky path requiring `security-reviewer`,
  `code-reviewer` and `typescript-reviewer` review even for comment-only edits.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web` →
  13 successful, 13 total (6 cached). All `@edmate/db` test files green, coverage per-file
  shown (unchanged files unaffected); `@edmate/web` typecheck/lint/test green including the two
  new `accountExport.test.ts` cases.
- `corepack pnpm exec prettier --check` on the three changed files → "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Tool calls used: 29 (harness count; the builder reported 17)
