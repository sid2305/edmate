# 12.3e plan (lead-written)

Status: READY

## Goal
The two 12.3b review LOWs.

## Steps
1. `packages/db/src/repositories/chunks.ts`: run `corepack pnpm exec prettier --write` on it and
   check the diff is formatting only (the review found a JSDoc line that lost its leading
   asterisk; fix whatever prettier reports, nothing else).
2. `packages/db/test/documents.int.test.ts`: replace the non-null assertions after
   `expect(...).not.toBeNull()` (`at!` around line 471-473, `fresh!` around line 524, and any
   other `x!.` after such an expect in this file) with a narrowing guard, e.g.
   `if (at === null) throw new Error('expected rights_declared_at');` (or the file's existing
   helper if it has one). Test behaviour stays the same.

## Risky paths
None (packages/db/test and a formatting-only change in a repository file). Note:
packages/db/src/repositories/** is in the security-reviewer group; the change is formatting only,
so the lead decides at merge (reviewers: code-reviewer, plus security-reviewer if the gate
requires it).

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
- `corepack pnpm exec prettier --check packages/db/src/repositories/chunks.ts packages/db/test/documents.int.test.ts`
- `python3 .githooks/secret-scan.py --all`

## Budget
About 15 tool calls.
