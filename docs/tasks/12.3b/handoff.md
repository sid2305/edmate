# 12.3b handoff: rights declaration per document and copyright takedown count (12.3 Phase B, packages/db)

Status: DONE

- Branch: `m12/12.3b-rights-declaration-db` (built locally as `work-123b`)
- Worktree: `.claude/worktrees/agent-a320d0d26ae28e133`

## Summary
The declaration is stored per document and the repeat-infringer count exists. Per the lead's
answer (option 2), `rightsDeclared` is optional until 12.3c makes it required in the web routes
(create, web link and replace together).

- `documents.create` / `startReplace` take `rightsDeclared: z.literal(true).optional()`. When it
  is true, `rights_declared_at = now()` (a replace stamps a fresh time). When it is absent, create
  leaves the column null and replace clears it to null (the new file has no declaration yet).
  `false` or any other value is `invalid` before any SQL, nothing written. No `apps/` edits.
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

## Files
- `packages/db/src/repositories/takedowns.ts` (`countUpheld`, header note, `auditLog` and
  `teacherScope` imports)
- `packages/db/src/repositories/chunks.ts` (`rightsDeclared` on both input schemas, stamped or
  cleared in create and startReplace; `documentColumns` reads `rightsDeclaredAt`)
- `packages/db/src/repositories/map.ts` (`DocumentRowSchema`, `toDocumentRow`, comment)
- `packages/db/src/repositories/README.md` (one bullet under "Takedowns (task 12.2b)")
- `packages/db/test/takedowns.int.test.ts` (new describe: 4 tests)
- `packages/db/test/documents.int.test.ts` (4 tests: read side, create, invalid, replace)
- `packages/db/test/repositories.int.test.ts` (shared, append: `takedowns.countUpheld` case)
- `packages/db/test/scope.test.ts` (shared: the `takedowns.` grid skip now lets `countUpheld`
  through, since it takes a teacher scope)

## Tests
Written first and run red (`repos.takedowns.countUpheld is not a function`, 4 failed;
`rightsDeclaredAt` expected undefined to be the stored time; the create/replace declaration tests
2 failed, the `false` case already failed closed through zod), then green. Integration tests ran on
disposable `pgvector/pgvector:0.8.1-pg16` containers (`edmate123b-pg-test` port 55823, then
`edmate123b-pg-test2` port 55824; both removed afterwards).

- `vitest run test/takedowns.int.test.ts` → `Tests  21 passed (21)`
- `vitest run test/documents.int.test.ts` → `Tests  31 passed (31)`
- `vitest run test/repositories.int.test.ts test/scope.test.ts test/takedowns.test.ts test/takedowns.int.test.ts` → `Tests  386 passed (386)`
- `TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --concurrency=2`
  (after the optional-input change) → `Tasks: 26 successful, 26 total`. At the default
  concurrency `@edmate/harness#test` fails now and then on a load-sensitive guard test (harness
  untouched; it passes on rerun).
- `python3 .githooks/secret-scan.py --all` → clean.

Covered: create with `true` stamps now and returns it; create without leaves null; `false`,
`'true'`, `1`, `null` are `invalid` with nothing written (create and replace); replace with `true`
gives a fresh time, replace without clears it. Active copyright on own document and own agent
counted; harmful not counted; lifted not counted; another teacher's not counted; unknown teacher
is 0; raw `teacher:<id>` / `upheld` / `open` rows not counted; a deleted taken-down document still
counts; malformed scope is `scope` before any SQL; isolation grid (A counts, B and a ghost
teacher 0, back to baseline on lift).

## Decisions

### 22 Oct 2026 · 12.3b countUpheld reads takedowns for the teacher's own content (risky path, security-reviewer) · decided by builder · risk: high
- Decided: `takedowns.countUpheld(scope)` in `packages/db/src/repositories/takedowns.ts` counts active `copyright` takedowns on the teacher's own documents or agents, teacher-scoped and read only, with no lock and no caller yet; `documents.create` / `startReplace` in `chunks.ts` now stamp or clear `rights_declared_at`. Reviewer required: security-reviewer.
- Why: the 12.3 plan's lead answers (12.2's literals, count only); `packages/db/src/repositories/**` is a risky path.
- risk: high

### 22 Oct 2026 · 12.3b the takedown's audit row also proves ownership · decided by builder · risk: medium
- Decided: a takedown counts for a teacher when its target is theirs now or when its own `takedown.create` audit row (same target, `after.takedown` = the takedown id) names them, so deleting a taken-down document does not clear the count.
- Why: `documents.delete` removes the document row, so a join on the target alone would let a teacher erase a strike; the audit row is written in the same transaction as the takedown and is never deleted. No migration needed.
- risk: medium

### 22 Oct 2026 · 12.3b rightsDeclared is optional until 12.3c · decided by lead · risk: low
- Decided: `documents.create` / `startReplace` accept `rightsDeclared: true` as optional: true stamps `rights_declared_at = now()`; absent leaves it null on create and clears it on replace; `false` is `invalid`. 12.3c makes it required for create, web link and replace together, with the routes.
- Why: requiring it now would break three production routes in `apps/web/src/studio/routes.ts`; web links will need the declaration too (lead answer, option 2).
- risk: low

## Left to do
- 12.3c: make `rightsDeclared` required for create, web link and replace, with the three calls in
  `apps/web/src/studio/routes.ts` passing `body.rightsDeclared` (plus `routes.test.ts`,
  `apps/worker/test/ingest.int.test.ts` and the db tests that create documents).

Tool calls used: 59
