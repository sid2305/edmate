# 8.6f review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

All four approve. The first review round found a deadlock: `package-versions.ts` create took the module locks before the package-row lock, the reverse of `packages.ts` saveVersion. The fix round moved both writers onto shared helpers in `package-write.ts`, which lock the package row first and then the module rows, and added a test that runs the two writers at the same time. security-reviewer and database-reviewer verified the fix. code-reviewer and typescript-reviewer reviewed the whole branch (Phase A in packages/db, Phase B in apps/web).

## Findings
- [CRITICAL] [fixed] packages/db/src/repositories/package-versions.ts — lock order was module rows before package row, the reverse of packages.ts saveVersion (deadlock risk); both now go through lockPackageRow, then checkModules, in package-write.ts, and a two-writer concurrency test covers it.
- [LOW] [wontfix] apps/web/src/studio/publish.ts — this and the other studio and staff handlers switch on `error.kind` without a `never` check, so a future `limit` error would fall through to a generic 500; none of them can raise `limit` today.
- [LOW] [wontfix] packages/db/src/repositories/errors.ts — informational: the new `limit` kind and its four exhaustive switches compile cleanly; nothing to change.
