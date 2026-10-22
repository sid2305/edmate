# 12.3f handoff: rightsDeclared becomes required in packages/db documents create, web link and replace

Status: PARTIAL

Branch: `m12/12.3f-rights-required` (pushed from local `work-123f`)
Worktree: `.claude/worktrees/agent-a18102ee0d45f0057`

## Summary
- `documents.create` (which the web link route also calls) and `documents.startReplace` now
  require `rightsDeclared: true`. The zod schemas use `z.literal(true)` (no `.optional()`), so the
  inferred `DocumentInput` and the `startReplace` input type have `rightsDeclared: true` as a
  required key: leaving it out is a typecheck error. At runtime (untyped JS) a missing or non-`true`
  value fails `parseArg` and returns the repo's `invalid` result before any write.
- Both writes now always stamp `rights_declared_at = now()`; the old "replace without it clears the
  declaration" branch is gone (it can't happen any more).
- No schema edit, no migration, no `packages/contracts` change.

## Why PARTIAL
`apps/web` fails typecheck after this change, at one test file the brief does not let me edit:

- `apps/web/app/api/staff/reports/route.int.test.ts:103-106` calls `db.repos.documents.create(...)`
  without `rightsDeclared`. Fix: add `rightsDeclared: true` to that object literal. The three
  production calls in `apps/web/src/studio/routes.ts` already pass `body.rightsDeclared` and
  typecheck clean.

## Files
- `packages/db/src/repositories/chunks.ts` (documents repo): `DocumentInputSchema` and
  `ReplaceInputSchema` require `rightsDeclared: z.literal(true)`; `startReplace` input type;
  doc comments.
- `packages/db/test/documents.int.test.ts`: new test "12.3f: a create or replace without
  rightsDeclared is invalid and writes nothing" (create, a web-link-shaped create, replace; checks
  nothing written, storage key kept and revision unchanged); the two old "without it" assertions
  were removed; helpers pass `rightsDeclared: true`.
- Callers updated to pass `rightsDeclared: true` (additions only): `packages/db/test/`
  `access-property`, `outline`, `recall`, `repositories`, `retrieval`, `retrieval-hnsw`,
  `retrieval-leak`, `takedowns`, `video-ingest` int tests; `apps/worker/test/ingest.int.test.ts`.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/worker...`
  with `TEST_DATABASE_URL`/`TEST_REDIS_URL` on disposable containers (`t123f-pg`, `t123f-redis`),
  after `git merge origin/main` → `Tasks: 38 successful, 38 total`; `@edmate/db:test Test Files
  74 passed (74)`; `@edmate/worker:test Test Files 37 passed (37)` (integration suites included).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).
- Two existing 12.3b tests in `documents.int.test.ts` were adjusted: a new row now always carries
  `rightsDeclaredAt`, and the "omitted before declaration" check nulls the column first (as for a
  row from before 12.3f).
- `corepack pnpm turbo run typecheck --filter=@edmate/web` → fails only at
  `app/api/staff/reports/route.int.test.ts(105,7)` (see Why PARTIAL).

## Decisions

### 22 Oct 2026 · 12.3f rightsDeclared is required on documents create and replace · decided by builder · risk: high
- Decided: `documents.create` and `documents.startReplace` in `packages/db/src/repositories/chunks.ts` take `rightsDeclared: true` as a required key (typecheck error if missing, `invalid` at runtime), and always stamp `rights_declared_at = now()`. Teacher notes (`insertTeacherNote`) keep no declaration: they are the teacher's own typed answers, not an upload. Risky path (`packages/db/src/repositories/**`): needs security-reviewer and database-reviewer.
- Why: 12.3b Left to do and the 12.3f accept line; apps/web already sends the declaration on all three calls, so the repo can now refuse an undeclared upload, link or replace.
- risk: high

## Left to do
- Add `rightsDeclared: true` to the `documents.create` call in
  `apps/web/app/api/staff/reports/route.int.test.ts` (line ~105) so `@edmate/web` typecheck is
  green, then run `--filter=@edmate/web` typecheck/lint/test.

Tool calls used: 37
