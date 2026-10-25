# 8.1d review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

GrantArgs and VerifyArgs are now `UserTarget & {...}`, with `UserTarget` a union tagged by `kind` (email | userId) built by a shared `buildUserTarget` helper. Both parsers still reject both-set and neither-set with the usage line, the CLIs switch on `args.kind` with no `args.email!`, exported signatures are unchanged, and log lines and exit codes are byte-identical (no email is printed). The both/neither tests already existed in packages/db/test/grant-role-cli.test.ts and verify-teacher-cli.test.ts and still pass.

## Findings
- [LOW] [wontfix] packages/db/src/cli.ts:79 — buildUserTarget's final `return undefined;` is unreachable at runtime; TypeScript cannot prove the two `if` branches exhaust the cases after the either-or guard, so the line keeps the function's return paths explicit.
