**Status:** DONE

## What changed

- `apps/web/src/studio/questions/routes.ts`: the `fromError` switch over `error.kind` now has a
  `default` branch that assigns `error.kind` to `const unreachable: never` before returning the
  same logged 500 the `failed` branch already returns. Adding a new `RepositoryErrorKind` now
  fails to compile here instead of silently reaching the 500. Updated the doc comment above the
  function to describe the `default`/`never` check instead of the old "no default case" claim.
- `apps/web/src/studio/profile.ts`: same change to its `fromError` -- a `default` branch assigns
  `error.kind` to `const unreachable: never`, then returns the same 500. Updated the doc comment.
- Runtime behaviour is unchanged: both `default` branches return exactly the response the
  function already fell through to.
- No test changes were needed to keep the type-level check inside the existing tests; the
  exhaustiveness check is enforced entirely at compile time by the `never` assignment, so it
  fails the build if `RepositoryErrorKind` ever grows a new member. A comment on each function
  documents this per the accept line.

## Evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`: 10/10 tasks
  successful (typecheck, lint, test all green). Test Files: 157 passed (157). Tests: 2430 passed
  (2430).
- `python3 .githooks/secret-scan.py --all`: exit 0, clean.

## Decisions

None.

## Budget
