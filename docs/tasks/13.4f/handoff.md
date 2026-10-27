# 13.4f handoff: account export pair dedup/cap + grantedBy zod enum

Status: DONE

## Summary

- `apps/web/src/export/accountExport.ts`: added `TEACHER_PAIRS_MAX = 100` (exported). In
  `buildAccountExport`, dedupe `listAllForStudent`'s pairs by `(teacherId, agentId)` before
  building per-pair exports, keeping the row with the later `periodEnd`; cap the deduped list at
  `TEACHER_PAIRS_MAX` and push `'teachers'` onto `truncated` when the cap is hit (same
  "named cap + truncated flag" shape as `'evidence'`/`'teacherQuestions'` in `buildExport.ts`).
- `apps/web/src/export/accountExport.test.ts`: two new cases — two pairs with the same
  `(teacherId, agentId)` give one `teachers` entry, the one with the later `periodEnd`; more than
  `TEACHER_PAIRS_MAX` distinct pairs caps `json.teachers.length`, sets `complete: false`, and
  `truncated` contains `'teachers'`.
- `packages/db/src/identity/store.ts`: added `const GrantedBy = z.enum(['self', 'parent'])` and
  extracted the per-row mapping into an exported pure function `parseConsentRow` (same pattern as
  `age.ts`'s `ageStatus`). `listConsentsForStudent` now maps rows through `parseConsentRow` instead
  of casting `row.grantedBy as 'self' | 'parent'`.
- `packages/db/test/identity-consent-row.test.ts` (new, plain `.test.ts`, no DB): calls
  `parseConsentRow` directly with a fabricated row; asserts a good `'self'`/`'parent'` row maps
  correctly, and a bad `grantedBy` (`'bad'`, `''`, `'parent '`, `'Self'`, `'PARENT'`) throws.
- `docs/tasks/13.4f/handoff.md`: this file.

No other files touched.

## Decisions

None beyond the plan — both findings had a concrete, bounded fix as described, and no new
decision was needed.

## Gate

- `export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate && corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web`
  → **13 successful, 13 total** (typecheck/lint/test for both packages). `@edmate/db:test`:
  **82 test files, 1771 passed | 4 skipped (1775)**, including the new
  `test/identity-consent-row.test.ts` (7 tests) and the existing `identity.int.test.ts`
  `listConsentsForStudent` cases unaffected. `src/identity/store.ts` coverage: 100% stmts/funcs/lines,
  98.5% branch. `apps/web`'s test task also passed (exit code 0 across all 13 tasks); the new
  `accountExport.test.ts` dedup/cap cases ran as part of that task.
- `corepack pnpm exec prettier --check` on the four changed files → clean (one `--write` pass was
  needed on `accountExport.test.ts` first).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Risky paths

`packages/db/src/identity/**` (`store.ts`) is on `.claude/skills/merge-gate/risk-paths.txt` — this
PR needs `security-reviewer`, `database-reviewer`, `code-reviewer` and `typescript-reviewer`
(same set 13.4d used on this file), and a `risk: high` decision at merge.

## Budget
Tool calls used: 38
