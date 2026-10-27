# 1.7d handoff

Status: DONE

## Summary

Fixed the 1.7b review MEDIUM/LOWs in `apps/web/test/build-smoke.test.ts`, `turbo.json` and
`apps/web/src/auth/age.ts`, test-first.

- `apps/web/test/build-smoke.test.ts`
  - `beforeAll`: recovers a stale `.build-smoke-hidden` dir left by an earlier crashed run
    (discards it if `dist` is also present; restores it otherwise) before the relocate step.
  - `cpSync(BUILD_STANDALONE, tmpRoot, { recursive: true, verbatimSymlinks: true })`: a symlink
    inside `.next/standalone` (pnpm's workspace links) copies as-is instead of being resolved
    against the source tree.
  - Rewrote the comment on the spawned server's `cwd` to describe today's `bySibling`/
    `EDMATE_CONTENT_WORKER_DIR` resolution in `packages/content/src/safeRegexGuard.ts` (the
    `byCwd` it used to cite no longer exists there).
  - Added an assertion that the production fail-closed message
    (`'the compiled safe-regex worker is missing in production (failing closed)'`) never appears
    anywhere in the captured stderr, not just on the one ZZ refusal line — the only thing that
    would prove the worker genuinely loaded from the relocated, `NODE_ENV=production` copy rather
    than merely that the ZZ line happens to look right.
  - `afterAll`: nested try/finally so restoring `HIDDEN_CONTENT_DIST` and removing `tmpRoot`
    still run even if an earlier step (waiting on the child, the erase, or `dbClose`) throws.
    Checks `child.exitCode`/`child.signalCode` before waiting for another `'exit'` event (a
    process that already exited never fires one again, which is what made this time out).
  - Erases the student row this test created (and its session, in the same transaction) in
    `afterAll` before `dbClose`, through `identity.recordAgeAnswer`'s `under_age` branch (the
    same erase path `age.ts` itself uses) — never a raw SQL delete. The store here has no
    `noticeVersion` option set, so that check is skipped and any value works.
- `turbo.json`: `build-smoke` task gets `"cache": false`.
- `apps/web/src/auth/age.ts`: the log-line strip now also removes C1 controls (U+0080–U+009F,
  including NEL U+0085) and U+2028/U+2029, and `r.file` goes through the same strip as the
  reasons (previously only the reasons were stripped).
- `apps/web/src/auth/age.test.ts`: new unit test (`1.7d: strips C1 controls and U+2028/U+2029
  from the file name and the reason, too`), spying on `@edmate/content`'s `loadLocalePacks`
  (renamed the module's namespace import to `contentPkg` to avoid shadowing the file's own local
  `content` variable) to hand `loadAgeContent` a refused pack whose file name and reason both
  carry the new characters, asserting the logged line is exactly one line and contains none of
  them.

## Decisions

### 26 Oct 2026 · 1.7d budget overrun (149 vs 40) · decided by lead · risk: low
- Decided: accept 149 tool calls against the 40 budget.
- Why: the gate includes a full production build plus build-smoke, which the builder ran several times while making the cleanup reliable; the change stayed inside the plan's files and all three reviewers approved (one MEDIUM deferred). Future build-smoke tasks get a budget of about 80.

### 26 Oct 2026 · 1.7d review MEDIUM deferred to 1.7i, two LOWs wontfix · decided by lead · risk: low
- Decided: the code-reviewer MEDIUM (apps/web/test/build-smoke.test.ts assigns eraseStudent only after createSession succeeds, so a createSession failure leaks the student row) goes to board task 1.7i. Wontfix: apps/web/src/auth/age.ts does not strip bidi-override characters (out of scope: the strip prevents log-line splitting, not visual spoofing); apps/web/test/build-smoke.test.ts's nested try/finally in afterAll can let a later cleanup error replace an earlier one (accepted so the restore steps always run).
- Why: fix only CRITICAL/HIGH before merge; the LOWs are informational, by the reviewers' own account.

### 26 Oct 2026 · 1.7d cleanup erases the student through recordAgeAnswer, not a new delete method · decided by builder · risk: low
- Decided: `IdentityStore` has no direct "delete this student" method (by design — `anonymise`
  only clears fields, it never deletes the row). The build-smoke test's `afterAll` now erases the
  student and session rows it created by calling `identity.recordAgeAnswer` with a birth year a
  few years old (under every market's minimum age) for the `global` market, which takes the same
  `under_age` branch `age.ts` itself uses in production — deleting the sign-in rows and the user
  row in one transaction. This stays inside the public `@edmate/db` API (`apps/web` cannot import
  `@edmate/db/internal`, a lint rule enforces that) and matches the plan's "through the same
  identity/db API the test used to create them; no raw SQL string building."
- Why: no dedicated delete method exists, and adding one to `@edmate/db` is out of scope for a
  test-hardening task; the age-gate's own erase path already does exactly this, with a store-level
  guarantee (no `noticeVersion` option set here) that the call cannot fail on a version mismatch.

### 26 Oct 2026 · 1.7d assembles the fail-closed assertion from the production code's own string · decided by builder · risk: low
- Decided: the new build-smoke assertion that `log` never contains
  `'the compiled safe-regex worker is missing in production (failing closed)'` uses the exact
  string literal from `packages/content/src/safeRegexGuard.ts`'s `unsafeInProduction`, copied by
  hand rather than imported (that function is not exported).
- Why: the plan says to use the exact message the code logs today and not change it; copying the
  literal is the only way to assert on it from a different package's test without exporting a
  production-only error string purely for test use.

### 26 Oct 2026 · 1.7d merge touches apps/web/src/auth/age.ts · decided by builder · risk: high
- Decided: this PR touches `apps/web/src/auth/**` (a risky path), so the merge needs
  security-reviewer, code-reviewer and typescript-reviewer named in `review.md`, per the plan's
  "Risky paths" section and the repo's non-negotiable rule 6.
- Why: `age.ts` is the age gate's own log-stripping code; a mistake there is a privacy/safety
  regression (a control character splitting a log line, or stripping too much/too little), so it
  gets the same reviewer set as any other change to that file.

## Gate

```
$ export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/web
 Tasks:    10 successful, 10 total
(all green: typecheck, lint, test for @edmate/web and its workspace dependencies)

$ corepack pnpm --filter @edmate/web build
(Next build succeeded; /welcome/age among the routes listed)

$ corepack pnpm --filter @edmate/web build-smoke
 Test Files  2 passed (2)
      Tests  3 passed (3)
(dev Postgres at TEST_DATABASE_URL was reachable; build-smoke ran for real, not skipped —
 includes the new fail-closed-message assertion over the full captured log)

$ corepack pnpm exec prettier --check apps/web/test/build-smoke.test.ts turbo.json apps/web/src/auth/age.ts apps/web/src/auth/age.test.ts
All matched files use Prettier code style!

$ python3 .githooks/secret-scan.py --all
(no output: clean)
```

One unrelated flaky failure was seen on an earlier, loaded run of the full `turbo run ... test`
(`src/turn/routes.test.ts > aborting the request stops the stream, and the gateway sees the
cancel`, `expected 100 to be less than 100`) — a timing-sensitive test in a file this task does
not touch (another builder's path, per the brief). It passed on its own and on every later full
run; not investigated further here.

## Budget

Tool calls used: 149 (harness count; the builder reported 67)
