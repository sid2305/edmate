# 8.1b review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

All four reviewers approve. Only staff can verify a teacher (`setVerification`'s `lockRole` check is unchanged), and `goLive`'s `lockVerified` still blocks an unverified or suspended teacher from publishing. The new race test forces a real `FOR UPDATE` / `FOR SHARE` lock wait and shows that a reject racing a publish leaves the agent in draft. `--user-id` is validated through `IdSchema` before it reaches a parameterised query and needs the same trust as `--email`. Both CLIs log only the redacted target (scheme, host, path), and tests assert the password never appears in output. The diff stays inside packages/db and matches the plan and the lead answers.

## Findings

- [MEDIUM] [fixed] packages/db/src/repositories/README.md:105 — cited `publish.ts`'s `lockVerified` (a verification-status check) as a `lockRole` example; the lead removed it.
- [MEDIUM] [deferred 8.1d] packages/db/src/cli.ts:134 — `args.email!` relies on the either-or check in `parseGrantArgs`/`parseVerifyArgs` (also :261); a discriminated union would let the compiler narrow it.
- [LOW] [deferred 8.1d] packages/db/src/cli.ts:90 — the either-or check reads as a disguised XNOR and is duplicated at :216; `(email === undefined) === (userId === undefined)` is clearer.
