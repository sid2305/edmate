# 12.3b handoff: rights declaration per document and copyright takedown count (12.3 Phase B, packages/db)

Status: PARTIAL

- Branch: `m12/12.3b-rights-declaration-db` (built locally as `work-123b`)
- Worktree: `.claude/worktrees/agent-a320d0d26ae28e133`

## Summary
Done: the read side of the declaration and the repeat-infringer count. Not done: making
`rightsDeclared: true` a required input of `documents.create` / `startReplace`, because three
production web routes call them (see "Why PARTIAL").

- `takedowns.countUpheld(scope)` (added to 12.2b's `takedowns.ts`, name kept): counts the scope
  teacher's takedowns with `status = 'active'` and `reason = 'copyright'` whose target is one of
  that teacher's documents or agents. A lifted takedown does not count; a `teacher:<id>` target or
  any other status (`upheld`, `open`) is never counted. The owner is the target's teacher now **or**
  the teacher named on the takedown's own `takedown.create` audit row, so a teacher who deletes a
  taken-down document keeps the count (`documents.delete` removes the row the join would need).
  Read only: no lock, no caller, no threshold or enforcement (12.3d).
- `DocumentRow.rightsDeclaredAt` (optional ISO time) is now returned by `documents.get` and
  `listForTeacher`, read like `failureReason` (absent when null). The stale map.ts comment is fixed.
- No migration, no schema edit, no `packages/contracts` change; the write side of takedowns is
  untouched.

## Why PARTIAL
Making `rightsDeclared: z.literal(true)` required on `DocumentInputSchema` / `ReplaceInputSchema`
breaks the typecheck of three production calls in `apps/web/src/studio/routes.ts`:
- `create` (file upload, `b.documents.create`, around line 243),
- the web-link route (`b.documents.create` with `kind: 'material'`, around line 326; the 12.3
  plan does not mention links at all),
- `replace` (`b.documents.startReplace`, around line 366).
Per the brief, a production web route needing the field is a stop. Passing a hard-coded `true`
there would record a declaration the teacher never made. Also touched by the change (tests only):
`apps/web/src/studio/routes.test.ts` (fake backend), `apps/worker/test/ingest.int.test.ts`, and
about ten `packages/db/test/*.int.test.ts` files.

Options for the lead:
1. Fold the required input into 12.3c (one PR changes the repo schema and the three routes
   together, routes passing `body.rightsDeclared`).
2. Ship it here as `rightsDeclared: z.literal(true).optional()` (stamp `rights_declared_at` only
   when given), and 12.3c makes it required once the routes send it.
3. Decide whether a web link needs a rights declaration at all (it is not an upload).

## Files
- `packages/db/src/repositories/takedowns.ts` (`countUpheld`, header note, `auditLog` and
  `teacherScope` imports)
- `packages/db/src/repositories/chunks.ts` (`documentColumns` reads `rightsDeclaredAt`)
- `packages/db/src/repositories/map.ts` (`DocumentRowSchema`, `toDocumentRow`, comment)
- `packages/db/src/repositories/README.md` (one bullet under "Takedowns (task 12.2b)")
- `packages/db/test/takedowns.int.test.ts` (new describe: 4 tests)
- `packages/db/test/documents.int.test.ts` (1 test)
- `packages/db/test/repositories.int.test.ts` (shared, append: `takedowns.countUpheld` case)
- `packages/db/test/scope.test.ts` (shared: the `takedowns.` grid skip now lets `countUpheld`
  through, since it takes a teacher scope)

## Tests
Written first and run red (`repos.takedowns.countUpheld is not a function`, 4 failed;
`rightsDeclaredAt` expected undefined to be the stored time), then green. Integration tests ran
on a disposable `pgvector/pgvector:0.8.1-pg16` container (`edmate123b-pg-test`, port 55823,
removed afterwards).

- `vitest run test/takedowns.int.test.ts` → `Tests  21 passed (21)`
- `vitest run test/documents.int.test.ts` → `Tests  28 passed (28)`
- `vitest run test/repositories.int.test.ts test/scope.test.ts test/takedowns.test.ts test/takedowns.int.test.ts` → `Tests  386 passed (386)`
- `TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` →
  db, typecheck and lint green; `@edmate/harness#test` failed once on a load-sensitive guard test
  (`a soft hit never escalates…`, 4.2 s, harness untouched) and passed on rerun
  (`turbo run test --filter=@edmate/harness` → `Tasks: 2 successful, 2 total`). Final run after
  `git merge origin/main` is in the commit's gate (see the lead's report).
- `python3 .githooks/secret-scan.py --all` → clean.

Covered: active copyright on own document and own agent counted; harmful not counted; lifted not
counted; another teacher's not counted; unknown teacher is 0; raw `teacher:<id>` / `upheld` /
`open` rows not counted; a deleted taken-down document still counts; malformed scope is `scope`
before any SQL; isolation grid (A counts, B and a ghost teacher 0, back to baseline on lift).

## Decisions

### 22 Oct 2026 · 12.3b countUpheld reads takedowns for the teacher's own content (risky path, security-reviewer) · decided by builder · risk: high
- Decided: `takedowns.countUpheld(scope)` in `packages/db/src/repositories/takedowns.ts` counts active `copyright` takedowns on the teacher's own documents or agents, teacher-scoped and read only, with no lock and no caller yet. Reviewer required: security-reviewer.
- Why: the 12.3 plan's lead answers (12.2's literals, count only); `packages/db/src/repositories/**` is a risky path.
- risk: high

### 22 Oct 2026 · 12.3b the takedown's audit row also proves ownership · decided by builder · risk: medium
- Decided: a takedown counts for a teacher when its target is theirs now or when its own `takedown.create` audit row (same target, `after.takedown` = the takedown id) names them, so deleting a taken-down document does not clear the count.
- Why: `documents.delete` removes the document row, so a join on the target alone would let a teacher erase a strike; the audit row is written in the same transaction as the takedown and is never deleted. No migration needed.
- risk: medium

### 22 Oct 2026 · 12.3b the required rightsDeclared input waits for the lead · decided by builder · risk: low
- Decided: `documents.create` / `startReplace` do not yet require `rightsDeclared: true`; only the stored time is returned (`DocumentRow.rightsDeclaredAt`).
- Why: three production routes in `apps/web/src/studio/routes.ts` (create, web link, replace) would stop typechecking, and the brief says to stop rather than pass a declaration the teacher never made.
- risk: low

## Left to do
- Require `rightsDeclared: true` on `documents.create` and `startReplace` and stamp
  `rights_declared_at = now()` (tests: set on create, fresh on replace, `false`/missing is
  `invalid` with nothing written). Choose option 1, 2 or 3 above. Also decide on web links.
- Update the callers that change with it: `apps/web/src/studio/routes.ts` (3 calls),
  `apps/web/src/studio/routes.test.ts`, `apps/worker/test/ingest.int.test.ts` and the db tests.

Tool calls used: 44
