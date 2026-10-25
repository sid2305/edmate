# 8.1b plan: teacher-verification follow-ups (8.1 review items)

Status: READY

## Acceptance (verbatim)
Accept: a reject racing a publish never leaves the agent live (test); each item has a unit test or a note.

## How this is shown
- A new Postgres integration test in `packages/db/test/publish.int.test.ts` forces the race by
  hand (same `lockWaiters`/raw-transaction pattern the file already uses for its
  "re-click during goLive never deadlocks" test, lines 760-809): a raw transaction takes
  `FOR UPDATE` on the teacher's profile row (what `setVerification`'s reject path takes), a
  concurrent `publish.goLive` call blocks on `lockVerified`'s `FOR SHARE` (publish.ts:390-397,
  unchanged), the raw transaction then writes `verification_status = 'rejected'` and commits,
  and `goLive` is asserted to resolve `scope` with the agent's row never reaching
  `{status: 'live'}`. This proves the existing lock order (already added by 8.7, not part of
  this task's diff) closes the TOCTOU window the 8.1 review flagged; see Q1 below for why a
  *plain* reject still doesn't suspend an already-live agent (9.3e's design, unchanged here).
- Every other review item gets its own unit test (CLI behaviour, usage text) or, where nothing
  observable changes, a one-line note in the handoff citing the file and line (migration cast
  style; `setVerification` already using `translateWrite`).

## Source map (read before building)
- `packages/db/src/repositories/teacher-profiles.ts` — `update` (lines ~206-229, no
  `translateWrite`); `setVerification` (lines ~253-326, **already** wraps its transaction in
  `translateWrite` — the 8.1 review's finding at this point is stale; nothing to change there).
- `packages/db/src/repositories/publish.ts` — `lockVerified` (~389-397, `FOR SHARE` on the
  profile inside `startRun`/`goLive`'s transaction) and `setVerification`'s `FOR UPDATE` on the
  same row already give the lock order the review asked for; **no change needed here**, only a
  test proving it.
- `packages/db/src/cli.ts` — `runGrantRoleCli`/`parseGrantArgs` (~63-139) and
  `runVerifyTeacherCli`/`parseVerifyArgs`/`OpenVerify` (~141-250). Both open a `Db` from
  `env.DATABASE_URL` and never log anything about the target.
- `packages/db/src/redact.ts` — one function, strips the connection-string scheme's userinfo
  (the `user:password@` part of a `postgres(ql)://` URL) from error text. Mirror of
  `packages/gateway/src/transcriber/source.ts`'s `redactUrl` (scheme + host + pathname, no
  userinfo/query/fragment) — same idea, new function, not imported (packages/db does not depend
  on packages/gateway).
- `packages/db/src/identity/store.ts` — `IdentityStore.getUser(id)` already exists (line ~262,
  returns `IdentityUser | null`); `grantRole` already takes `userId: IdSchema` directly
  (line ~176). Both CLIs can resolve `--user-id` with no new repository method.
- `packages/db/src/repositories/README.md` — rule 9 (~line 38-43) and "Adding a method"
  (~line 97-102) don't mention `role-lock.ts`.
- `packages/db/migrations/0016_teacher_verification_status.sql` — note only, see Decisions below.
- Tests to extend: `packages/db/test/grant-role-cli.test.ts`, `packages/db/test/verify-teacher-cli.test.ts`
  (both pure-fake unit tests today, no real DB); `packages/db/test/publish.int.test.ts` (real
  Postgres, uses the package's existing dev database the same way every other `*.int.test.ts`
  file here does — do **not** stand up a throwaway container or touch
  `docker/postgres/**`; follow the "Builder Postgres bind mount" lesson: run from the main
  worktree's compose database, not a new one).

## Files to change
1. `packages/db/src/repositories/teacher-profiles.ts` — wrap `update`'s existing
   `db.update(...)` in `translateWrite('teacherProfiles.update', () => ...)`, same shape as
   `create`. No behaviour change today (no unique/FK constraint on the columns `update` writes),
   kept for consistency and in case a future column adds one.
2. `packages/db/src/redact.ts` — add `redactTarget(url: string): string`: parse with `new URL`,
   return `` `${protocol}//${host}${pathname}` `` (no userinfo, query or fragment); on a parse
   failure return `'[unparseable database url]'`. Export it.
3. `packages/db/src/cli.ts`:
   - `GrantArgs`/`parseGrantArgs`: accept `--user-id <id>` as an alternative to `--email`
     (exactly one of the two required; both or neither is a usage error). `USAGE` gains
     `--user-id <id>` as an alternative to `--email`, and a one-line note that `--reason` holds
     no personal details (it is stored in `audit_log`).
   - `runGrantRoleCli`: when `--user-id` is given, call `identity.getUser(args.userId)` instead
     of `getUserByEmail` (same "no user has that id" message on `null`); otherwise unchanged.
     Before opening the handle, log one line with `redactTarget(url)` (e.g.
     `` `db:grant-role: target ${redactTarget(url)}` ``), never the raw `url`.
   - `VerifyArgs`/`parseVerifyArgs`: same `--user-id`/`--email` either-or change.
     `VERIFY_USAGE` gains `--user-id <id>` and the same "no personal details in --reason" note.
   - `runVerifyTeacherCli`: same `--user-id` → `identity.getUser` branch, same target-redaction
     log line (`db:verify-teacher: target ...`).
   - `OpenVerify`'s `identity` type widens from `Pick<IdentityStore, 'getUserByEmail'>` to
     `Pick<IdentityStore, 'getUserByEmail' | 'getUser'>`.
4. `packages/db/src/repositories/README.md` — one added sentence under rule 9 and one under
   "Adding a method" naming `role-lock.ts`'s `lockRole` as the pattern for any new staff/role
   check inside a transaction (point to `teacher-profiles.ts`'s `setVerification` and
   `publish.ts`'s `lockVerified` as the two existing examples). No change to any other section.
5. Tests:
   - `packages/db/test/grant-role-cli.test.ts`: add cases — `--user-id` resolves via
     `identity.getUser` and skips `getUserByEmail`; `--email` and `--user-id` together is a
     usage error; neither given is a usage error; the printed target line never contains the
     password (assert on the full captured output, same `URL_WITH_PASSWORD` fixture already in
     the file); `USAGE` (printed on a bad call) contains `--user-id` and the no-personal-details
     note.
   - `packages/db/test/verify-teacher-cli.test.ts`: the same four cases against
     `runVerifyTeacherCli`/`VERIFY_USAGE`/`OpenVerify` (extend the `fakeOpen` helper's `identity`
     fake with a `getUser` mock).
   - `packages/db/test/publish.int.test.ts`: the one new race test described in "How this is
     shown" above, placed next to the existing deadlock test (same `describe` block, reusing
     `lockWaiters`, `raw`, `makeTeacher`, `agentRow`, `STAFF`, `scope`, `pins`, `summary`,
     `scorecard`).
   - `packages/db/test/teacher-profiles.test.ts` / `.int.test.ts`: no new test — `update`'s
     existing cases already cover every input and `not_found` path unchanged; note this in the
     handoff instead (per "each item has a unit test **or a note**").

## Risky paths touched (.claude/skills/merge-gate/risk-paths.txt)
- `packages/db/src/repositories/teacher-profiles.ts` and `packages/db/src/repositories/README.md`
  match `packages/db/src/repositories/**` → reviewers: **security-reviewer** (required by the
  file). Recommend also running the package's customary **database-reviewer** and
  **typescript-reviewer** (not forced by risk-paths.txt, but the same group 8.1's own review
  used for every `packages/db` change) plus **code-reviewer** (runs on every PR anyway).
- `packages/db/src/cli.ts` and `packages/db/src/redact.ts` are **not** under
  `packages/db/src/repositories/**` or any other listed glob → not risk-path matched by file,
  even though they handle `DATABASE_URL` and role grants. No required-reviewer line needed for
  these two files alone, but since the PR as a whole touches `packages/db/src/repositories/**`
  (item above), the whole PR still needs `security-reviewer` named and a `risk: high` decision.
- `packages/db/test/**` (all three test files) is not listed in risk-paths.txt.
- No migration file changes (0016 is a note only, not edited) → no `database-reviewer`
  requirement from "migrations that drop or delete data" either.
- This PR needs `risk: high` logged (one risky-path group touched: `security-reviewer`),
  per rule 6, even though every individual change is small.

## Budget
Budget: 55 tool calls (1 phase, packages/db only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for `@edmate/db`, the secret scan, and
running the package's existing dev Postgres for the one new int test — no new containers, no
`docker/postgres/**` edits).

## Exit conditions
- `Status: DONE` once: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` is
  green (including the new race test against the existing dev Postgres), `python3
  .githooks/secret-scan.py --all` is clean, and every item in "Files to change" has either a
  test or a note in the handoff's `## Changes` section.
- `Status: PARTIAL` if the builder passes ~55 tool calls, or the race test can't be made to
  fail-before/pass-after cleanly (e.g. the existing lock order turns out not to close the race
  the way "How this is shown" expects) — stop, write up what was found, and leave the rest for a
  fix round or a follow-up task; do not touch `publish.ts` itself to "make the test pass" without
  flagging that as a new decision (it would be a behaviour change to a risky path beyond this
  task's listed files).

## Questions
1. **Should a plain (non-safety) rejection also suspend the teacher's live agents**, as the 8.1
   review's literal wording ("a reject suspends live agents") suggests, overriding 9.3e's decision
   that only a `safety: true` rejection suspends agents (a plain rejection "leaves existing
   subscribers access until their plan ends")?
   **Recommend: no.** The acceptance line only needs the TOCTOU race closed (already done by
   8.7's `lockVerified` `FOR SHARE`); re-opening 9.3e's product decision is out of this
   cleanup task's scope and would need its own decision entry if wanted later.
2. **Should `--user-id` and the "no personal details" usage note go on `grant-role` too**, or
   only `verify-teacher` (the review's cli.ts:150 and teacher-profiles.ts:49 findings named only
   the verify CLI)? **Recommend: yes, both** — the board task's title groups "verify/grant-role
   CLIs" together, and `grant-role`'s `--email` has the same shell-history exposure and its
   `reason` lands in `audit_log` (`role.grant`) the same way.
3. **Exact redacted-target format?** **Recommend:** mirror
   `packages/gateway/src/transcriber/source.ts`'s `redactUrl` shape
   (`scheme://host/pathname`, i.e. host, port and database name, no credentials/query/fragment),
   logged once per CLI run before opening the handle.
4. **Migration 0016's `USING` cast style (omits the intermediate `::text` that 0005 used)** —
   fix to match 0005, or leave as a note? **Recommend: note only.** The review itself calls it
   "functionally equivalent"; editing a generated migration plus its `meta/0016_snapshot.json`
   and `meta/_journal.json` for a cosmetic difference carries more risk (regenerated migration
   metadata on a path nothing else touches) than it resolves.

## Decisions to carry into the handoff
(the builder logs these as `## Decisions` entries, `risk: high` for the first per rule 6)
- Why no `publish.ts` edit: the review's "runs in the publish transaction with FOR SHARE" ask
  was already satisfied by 8.7's `lockVerified`; this task only adds the test that proves it.
- Why `setVerification` needed no `translateWrite` change: it already has one; only `update` did
  not.

## Lead answers (24 Oct 2026)

1. Q1: no. Keep 9.3e's design: only a safety rejection suspends live agents; a plain rejection leaves existing subscribers their access until the plan ends.
2. Q2: yes, `--user-id` and the no-personal-details usage note go on both `verify-teacher` and `grant-role`.
3. Q3: yes, mirror `redactUrl`'s shape (scheme, host, port and database name; no credentials, query or fragment).
4. Q4: note only; do not edit migration 0016 or its metadata.
