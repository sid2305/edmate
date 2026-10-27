# Plan: 6.3e — name applyMistakes' unused third parameter and test it is ignored

Status: READY (lead plan, 6.3d review LOWs)

## Change
1. `packages/db/src/repositories/ports.ts`, `profileStoreFor` (~line 154): `async applyMistakes(mistakeScope, known)`
   becomes `async applyMistakes(mistakeScope, known, _proposed)`, so it reads as deliberate that this adapter
   ignores the proposed tags (6.3a will persist them; `recordProposedMistakes` is the separate port). Add one short
   comment line saying so. The lint rule allows `_`-prefixed unused args (`argsIgnorePattern: '^_'`). Check that the
   port type in the harness/contracts already has the third parameter, so this compiles without touching contracts.
   No behaviour change.
2. `packages/db/test/profile-store.int.test.ts`, in the `profileStoreFor.applyMistakes` describe block next to
   "an empty known array is a no-op even with no sessionId" (~line 830): add a case that calls
   `store.applyMistakes!(scope, [], [<a proposed tag shaped like the port expects>])` and checks it resolves
   undefined and writes nothing (`learnerProfiles.get(scope)` is null). Use a fresh studentId like the
   neighbouring cases.

## Tests
Red-then-green is not possible for a no-op that already holds. Instead, temporarily make the adapter throw when
`_proposed.length > 0`, see the new case fail, then restore it. Note this in the handoff.
The db coverage gate for src/repositories/** is 100%: run the db tests with coverage and confirm no threshold error.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` (includes dependents);
`corepack pnpm --filter @edmate/db exec vitest run --coverage`; `prettier --check` on the changed files;
`python3 .githooks/secret-scan.py --all`.

## Risk
packages/db/src/repositories/** is a risky path. Required reviewer: security-reviewer. Also code-reviewer.
The lead logs a `risk: high` approval decision.

## Budget
About 25 tool calls.
