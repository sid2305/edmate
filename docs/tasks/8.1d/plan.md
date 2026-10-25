# 8.1d plan: discriminated-union CLI args in packages/db/src/cli.ts

Written by the lead (a mechanical type cleanup from the 8.1b review; no planner run).

## Acceptance (verbatim, board)
No non-null assertion on args.email; db typecheck, lint and test green.

### How it is shown (paste into handoff.md)
- `grep -n 'args.email!' packages/db/src/cli.ts` prints nothing.
- The existing cli tests still pass, plus one new test per CLI that `--email` and `--user-id` together (and neither) print the usage line.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` green.

## Design
1. `GrantArgs` and `VerifyArgs` become discriminated unions on the target, e.g.
   `type UserTarget = { kind: 'email'; email: string } | { kind: 'userId'; userId: string };`
   `type GrantArgs = UserTarget & { role: Role; by: string; reason?: string };` (same for `VerifyArgs` with `status`).
2. `parseGrantArgs` / `parseVerifyArgs`: the either-or check reads
   `if ((email === undefined) === (userId === undefined)) return USAGE;` (after narrowing both to `string | undefined`), then build the target with the `kind` tag.
3. `runGrantRoleCli` / `runVerifyTeacherCli` switch on `args.kind` (no `args.email!`, no `args.userId !== undefined` checks). Log lines and behaviour stay byte-for-byte the same.
4. No change to exported signatures of `runGrantRoleCli` / `runVerifyTeacherCli`.

## Files to create/modify
- packages/db/src/cli.ts
- packages/db/src/cli.test.ts (or the existing cli test file) — the both/neither usage tests if missing.
- docs/tasks/8.1d/handoff.md

## Files out of bounds
Everything else, in particular packages/db/src/audit.ts, packages/db/src/repositories/**, packages/db/src/identity/** and packages/db/src/bin/** (9.3h is editing packages/db in parallel).

## Tests
Existing cli tests unchanged and green; add the both/neither cases per CLI if they don't exist.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None.

## Questions
None.

## Budget
25 tool calls; stop at 35.
