# 8.1d handoff

**Status:** DONE

## What changed
- `packages/db/src/cli.ts`: `GrantArgs` and `VerifyArgs` are now discriminated unions on the
  user target. Added a shared `UserTarget` type (`{ kind: 'email'; email: string } | { kind:
  'userId'; userId: string }`) and a `buildUserTarget(email, userId)` helper that returns the
  tagged target or `undefined` when both or neither of `--email`/`--user-id` are given.
  `GrantArgs = UserTarget & { role, by, reason? }` and `VerifyArgs = UserTarget & { status, by,
  reason? }`.
- `parseGrantArgs` / `parseVerifyArgs` call `buildUserTarget` and return `USAGE`/`VERIFY_USAGE`
  when it is `undefined`, instead of the old either-or `typeof` check.
- `runGrantRoleCli` / `runVerifyTeacherCli` now switch on `args.kind === 'userId'` instead of
  `args.userId !== undefined`, and read `args.email` with no non-null assertion (TypeScript
  narrows it through the discriminated union).
- No change to exported signatures, log lines or behaviour. No test files needed changes --
  the both/neither usage-error tests already existed in both CLI test files.

## Evidence
- `grep -n 'args.email!' packages/db/src/cli.ts` prints nothing (exit code 1, no match).
- Existing cli tests pass unchanged, including the both/neither cases:
  - `test/grant-role-cli.test.ts`: "rejects --email and --user-id together as a usage error",
    "rejects neither --email nor --user-id as a usage error" (19 tests total, all passing).
  - `test/verify-teacher-cli.test.ts`: same two cases (23 tests total, all passing).
- `TEST_DATABASE_URL=... corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force --concurrency=1`
  → `Tasks: 26 successful, 26 total` (typecheck, lint and test all green across
  @edmate/db and its dependents).
- `python3 .githooks/secret-scan.py --all` → no output, clean.

## Decisions

### 25 Oct 2026 · 8.1d shared buildUserTarget helper · decided by builder · risk: low
- Decided: added one `buildUserTarget` helper (not inlined per-CLI) reused by both
  `parseGrantArgs` and `parseVerifyArgs`, narrowing via two explicit `if` branches
  (`email !== undefined && userId === undefined` / the reverse) rather than a ternary, so
  TypeScript narrows each branch without any non-null assertion.
- Why: the plan's suggested single-line equality check (`(email === undefined) === (userId
  === undefined)`) does not let TypeScript narrow `userId`/`email` to `string` afterward, so
  building the tagged target from it still needed an assertion. The two-branch form keeps the
  same semantics (reject both/neither) with no assertion anywhere, and sharing it avoids
  duplicating the either-or logic between the two CLIs.

### 25 Oct 2026 · 8.1d budget overrun (42 calls against a 25-call plan) · decided by lead · risk: low
- Decided: accept the overrun; the change is done and reviewed clean.
- Why: the lead-written plan's 25-call budget did not count setup (pnpm install, building db's dependencies) and a full db... gate with its dependents; the code change itself stayed inside the plan.

## Budget
Tool calls used: 42 (harness count; the builder self-reported 19)
