# 9.4f plan — 9.4e deferred items and review LOWs

## Acceptance (verbatim)
> web and db typecheck, lint and test green; each item fixed or given a logged wontfix.

Shown by: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`
green, plus each changed test file's own red-then-green run quoted in the handoff, plus a
`## Decisions` entry (wontfix, with reason) for every deferred item.

## Disposition (MVP first — fix cheap and real, defer the rest, reason given)

1. **Playwright `--webpack`** — DECLINE (wontfix, point to the existing owner). The real blocker
   is webpack's dev compile of `@edmate/queue`'s `bullmq` import breaking `/api/health`
   (`next.config.ts` / `packages/queue`, not `playwright.config.ts`); board task **1.7e**
   ("Turbopack for apps/web (1.7b trial)", `status: todo`) already owns finding and fixing that
   upstream problem. No new id needed — log a wontfix here that points to 1.7e instead of
   duplicating it.
2. **`ports.ts` reads `users.market` twice** — DEFER (wontfix, re-confirmed). Checked
   `packages/db/src/repositories/ports.ts`: `opts.learnerClear(studentId)` and
   `opts.studentMarket(studentId)` are still two separate `identity` calls on a `subscription`
   resolve, each reading `users.market` (confirmed by reading `identity/store.ts`'s
   `learnerStatus`/`getMarket`). A real fix needs a new combined identity method and a reshaped
   `EntitlementStoreOptions`, touching two risky paths (`identity/store.ts`, `ports.ts`) plus 7
   `packages/db/test` access fixtures (12+ files) for one extra indexed PK `SELECT` (sub-ms cost).
   Nothing has changed since 9.4e's disposition; same reasoning holds. Left on the board (no new
   id; already covered by this task's own history if it needs raising again).
3. **`listLiveForStudent` grid case order** — FIX. `packages/db/test/repositories.int.test.ts`'s
   `listLiveForStudent: live agents only, ended excluded...` test (around line 6627) asserts
   `toEqual([...])` in the `rows` grid's declaration order (teachers `1`, `2`, `6`), but
   `subscriptions.ts`'s `listLiveForStudent` query (confirmed by reading it) has no `.orderBy()` —
   unlike its sibling `listAllForStudent`, whose comment states it orders by `agents.id` "for a
   stable diff-friendly result". The test's current pass depends on Postgres returning rows in
   insertion order with no `ORDER BY`, which is not guaranteed. Fix the **test only**: sort both
   the actual result and the expected array by `agentId` before `toEqual` (or assert as a `Set`
   keyed by `agentId`), so the test no longer depends on `rows`' order. No production-code change
   (`listLiveForStudent` itself still has no stated order guarantee — adding one is a separate,
   bigger decision this task does not make). Per the plan brief, this file is not in the other
   builders' current busy-file list (`retrieval.ts`, `retrieval*.int.test.ts`,
   `export-cursor-paging.int.test.ts`), so it is free to touch now.
4. **`apiError`'s `headers` param excludes `cache-control`** — FIX.
   `apps/web/src/auth/errors.ts`: type the optional 4th param so an object carrying a
   `cache-control` key fails to typecheck, e.g.
   `Readonly<Record<string, string>> & { 'cache-control'?: never }`, and extend the doc comment to
   say headers must be caller-constant (never built from request-derived input, e.g. never echo a
   client-sent header back) — closing both the typescript-reviewer and security-reviewer LOWs from
   9.4e. Confirmed the only caller (`apps/web/src/turn/routes.ts`'s 429) already passes a
   server-computed constant (`{ 'Retry-After': String(SESSION_RETRY_AFTER_SECONDS) }`), so no
   call-site change is needed. Add one `apps/web/src/auth/errors.test.ts` case (or a
   `// @ts-expect-error` line) proving a `cache-control` key in `headers` fails to typecheck.
5. **`layout.test.tsx` keeps type safety on `RootLayout`'s props** — FIX.
   `apps/web/app/layout.test.tsx` currently calls `RootLayout({ children: 'hello' })` and reads
   `.props.lang` / `.props.children` off the returned `ReactElement`, whose `props` is typed `any`
   by default, so a shape mistake would not be caught at compile time. Fix by typing the returned
   element explicitly (e.g. a local `type HtmlElement = ReactElement<{ lang: string; children:
   ReactElement<{ children: ReactNode }> }>`) and asserting `RootLayout(...) as HtmlElement` once,
   instead of letting each `.props` access stay implicitly `any`. No change to `layout.tsx` or to
   any assertion's expected value.
6. **README garbled bare-id-exception sentence** — FIX. `packages/db/src/repositories/README.md`
   (added by 9.4e Phase B): the clause "...checked with `role-lock.ts`'s `lockRole` (not staff
   right now is `scope`, never an existence check on anyone else)" is missing words and doesn't
   parse. Reword to say what the surrounding sentences already establish: the method checks the
   caller holds the staff role via `lockRole`, failing with `RepositoryError('scope')` when they
   don't, and never checks for the existence of any other user. Doc-only; same sentence's meaning,
   not its claims.

## Files to create/modify
- `packages/db/test/repositories.int.test.ts` (item 3, test-only)
- `apps/web/src/auth/errors.ts` + `apps/web/src/auth/errors.test.ts` (item 4)
- `apps/web/app/layout.test.tsx` (item 5, test-only)
- `packages/db/src/repositories/README.md` (item 6, doc-only)

No new files.

## Files out of bounds
`packages/db/src/repositories/retrieval.ts`, `packages/db/test/retrieval*.int.test.ts`,
`packages/db/test/export-cursor-paging.int.test.ts` (other builders working there now — brief),
`packages/db/src/repositories/ports.ts`, `packages/db/src/identity/store.ts` (item 2, deferred),
`apps/web/playwright.config.ts`, `apps/web/next.config.ts`, `packages/queue/**` (item 1, deferred
to 1.7e), `apps/web/app/layout.tsx` (test-only fix, source unchanged), `apps/web/src/turn/routes.ts`
(no call-site change needed — confirmed in the disposition above; touch only if the gate proves
otherwise, and say so in the handoff), any `packages/db` migration, any other
`packages/db/src/repositories/*.ts` file.

## Tests first
- Item 3: confirm the existing test is red under a reordered `rows` array locally would prove the
  fragility (optional — the fix itself is the safety net); write the sorted comparison, run the
  existing test green, and leave a one-line comment on why it sorts.
- Item 4: add the red `@ts-expect-error`/typecheck-failure case for a `cache-control` key in
  `headers` first (confirm it is NOT currently a type error), then add the type guard and confirm
  it becomes a type error; keep the existing two `apiError` tests green throughout.
- Item 5: no new runtime assertion value changes; the type annotation itself is checked by
  `tsc`/`typecheck`, not by a new `expect`.
- Item 6: doc-only, no test.

## Risky paths touched (checked against .claude/skills/merge-gate/risk-paths.txt)
- `apps/web/src/auth/**` (errors.ts, item 4) — reviewers: **security-reviewer** (code-reviewer
  always required).
- `packages/db/src/repositories/**` (README.md, item 6) — reviewers: **security-reviewer**
  (code-reviewer always required).
- `packages/db/test/repositories.int.test.ts` (item 3) is **not** under
  `packages/db/src/repositories/**` (it's under `packages/db/test/`) and matches no risk-paths.txt
  glob — not risky.
- `apps/web/app/layout.test.tsx` (item 5) matches no glob — not risky.
- Log a `risk: high` decision at closeout for the two risky-path items (standing rule), per the
  group's reviewer requirement above.

No exported type from `packages/db` or `packages/contracts` changes (item 3 is test-only, item 6
is a doc string); `apiError`'s new 4th-param type is additive and used only inside `apps/web`, so
no dependent-package gate is needed beyond `--filter=@edmate/web`.

## Questions
None — every item above already has a disposition (fix or wontfix) and a reason from the 9.4e
plan or this plan; nothing here is an open decision for the human.

## Budget
Budget: 55 tool calls (1 phase, packages: web, db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only).

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`, plus
`python3 .githooks/secret-scan.py --all`.

## Exit conditions
`Status: DONE` once items 3-6 are fixed (each with its own test passing) and items 1-2 are logged
as wontfix decisions with a reason, and the gate above is green (or a failure is confirmed
pre-existing/unrelated, named explicitly). `Status: PARTIAL` past ~55 tool calls, or if any file
outside "Files to create/modify" needs changing (e.g. `routes.ts` turns out to need a call-site
change, or `repositories.int.test.ts` turns out to still be busy) — hand back rather than widen
scope.
