# 13.4f plan: account export pair dedup/cap + grantedBy zod enum

**Board id (resolved by the lead, 26 Oct 2026):** this task was renamed from a duplicate `13.4e` to `13.4f`; `13.4e` stays the 13.4b payment-dispute follow-up.

## Acceptance (verbatim)
> a student with two subscriptions to one teacher gets one teacher entry; the pair count is capped
> with a truncated flag; a bad grantedBy value fails loud in a test.

Shown by: new/edited tests in `accountExport.test.ts` (dedup + cap) and a new pure unit test for the
`grantedBy` parse in `packages/db/test` — no real DB round trip needed (see below).

## Files
- `apps/web/src/export/accountExport.ts` — dedupe `listAllForStudent`'s rows by `(teacherId, agentId)`
  before building per-pair exports (keep the row with the latest `periodEnd`); cap the deduped list at
  `TEACHER_PAIRS_MAX` (new local constant, exported for the test); push `'teachers'` onto `truncated`
  when the cap is hit (same style as `'evidence'`/`'teacherQuestions'` in `buildExport.ts`).
- `apps/web/src/export/accountExport.test.ts` — new cases: (1) two pairs with the same
  `(teacherId, agentId)` give one `teachers` entry, the one with the later `periodEnd`; (2) more than
  `TEACHER_PAIRS_MAX` distinct pairs caps `json.teachers.length` at the constant, sets `complete:
  false`, and `truncated` contains `'teachers'`.
- `packages/db/src/identity/store.ts` — replace `row.grantedBy as 'self' | 'parent'` with a
  `const GrantedBy = z.enum(['self', 'parent'])` parse. Extract the per-row mapping into a small
  exported pure function (e.g. `parseConsentRow`, same file, same pattern as `age.ts`'s pure
  `ageStatus`) so it is unit-testable with no DB.
- `packages/db/test/identity-consent-row.test.ts` (new, plain `.test.ts`, **not** `.int.test.ts`,
  same convention as `age.test.ts`) — calls `parseConsentRow` directly with a fabricated row whose
  `grantedBy` is `'bad'`/`''`/`'parent '` etc. and asserts it throws; a good row still maps correctly.
  No Postgres needed for this file. (The `consents_granted_by_check` DB constraint already blocks a
  bad value from ever being written through normal inserts, so this can't be shown as an
  `identity.int.test.ts` round trip — that's exactly why the pure-function split is the right shape:
  belt-and-braces against a future looser constraint or a row from outside this store's own writes.)

## Cap value
`TEACHER_PAIRS_MAX = 100`, matching the order of magnitude of `teacher-questions.ts`'s
`QUESTIONS_MAX_LIMIT = 200` (same "named cap + truncated flag" shape) but smaller, since each pair
fans out into a full `buildExport()` (sessions, messages, evidence, questions, etc.), not one row.

## Not in scope / don't touch
- No change to `packages/db/src/repositories/subscriptions.ts` or any other repositories file (other
  builders own those per the lead's note) — dedup/cap is pure application logic over the rows
  `listAllForStudent` already returns, so no new query is needed.
- No `packages/contracts` change: `ConsentRow`, `SubscriptionPair`, `AccountExportJson` all live in
  `@edmate/db` / `apps/web`, not contracts. If review finds otherwise, stop and say BLOCKED.
- `AccountExportBackend`'s shape (and the wired handler) is unchanged — this is dedup/cap on data the
  backend already returns, not a new backend call.

## Tests first
1. Write the two `accountExport.test.ts` cases and the new `identity-consent-row.test.ts` file; watch
   them fail against the current code (duplicate teacher entries; no cap; the cast never throws).
2. Implement the dedup/cap in `accountExport.ts` and the `GrantedBy` parse + `parseConsentRow` split
   in `store.ts`.
3. Re-run both suites green; confirm existing `identity.int.test.ts` `listConsentsForStudent` cases
   still pass unchanged (they exercise only `'self'`/`'parent'` rows, so the new parse is a no-op for
   them).

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/identity/**` (`store.ts`) → reviewers: `security-reviewer` (required by the risk
  group). Recommend keeping the same reviewer set 13.4d used on this exact file —
  `security-reviewer`, `database-reviewer`, `code-reviewer`, `typescript-reviewer` (the finding this
  task closes is typescript-reviewer's) — for a clean handoff and because this PR is a direct
  continuation of 13.4d's deferred MEDIUMs.
- `apps/web/src/export/accountExport.ts` matches no glob in risk-paths.txt (not `apps/web/src/auth/**`
  or `apps/web/app/api/**`) — not risky on its own.
- Handoff logs a `risk: high` decision (the PR still touches `packages/db/src/identity/**`).

## Gate
Touches both `@edmate/db` and `@edmate/web`:
```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web
```
Plus `corepack pnpm exec prettier --check` on changed files and `python3 .githooks/secret-scan.py --all`.

## Open questions
- None on scope/spec: both review findings have a concrete, bounded fix; no new decision needed.

## Budget
Budget: 45 tool calls (1 phase, @edmate/db + @edmate/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests, typecheck/lint, prettier --check, secret-scan only)

## Exit conditions
Status: DONE when both new test cases plus the pure `grantedBy` test are green, the existing
`accountExport.test.ts` and `identity.int.test.ts` suites are unaffected and green, and the gate
above is clean. Status: PARTIAL past ~55 tool calls, or if a fix turns out to need touching
`packages/db/src/repositories/subscriptions.ts` or any file outside this list (stop and hand back).
