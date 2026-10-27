# 9.4f handoff — 9.4e deferred items and review LOWs

Status: DONE

## Summary

Fixed items 3-6 from the plan's disposition; logged wontfix decisions for items 1-2 (already
decided, re-confirmed, no new id needed).

- `packages/db/test/repositories.int.test.ts` (item 3, test-only): the
  `listLiveForStudent: live agents only, ended excluded...` test asserted `toEqual` against a
  fixed-order array even though `listLiveForStudent` has no `.orderBy()`. Both the actual result
  and the expected array are now sorted by `agentId` (via a shared `byAgentId` comparator) before
  the `toEqual` comparison, so the test no longer depends on row order. No production-code
  change.
- `apps/web/src/auth/errors.ts` + `apps/web/src/auth/errors.test.ts` (item 4): `apiError`'s 4th
  `headers` param is now typed `Readonly<Record<string, string>> & { 'cache-control'?: never }`,
  so a `cache-control` key fails to typecheck. Extended the doc comment to say every header must
  be caller-constant, never built from request-derived input. Added a
  `// @ts-expect-error` test case proving the new type error; the two existing `apiError` tests
  stay green. Confirmed the only caller (`apps/web/src/turn/routes.ts`'s 429 response) already
  passes a server-computed constant (`{ 'Retry-After': String(SESSION_RETRY_AFTER_SECONDS) }`),
  so no call-site change was needed (confirmed per the plan — `routes.ts` untouched).
- `apps/web/app/layout.test.tsx` (item 5, test-only): added a local `HtmlElement` type
  (`ReactElement<{ lang: string; children: ReactElement<{ children: ReactNode }> }>`) and cast
  `RootLayout({ children: 'hello' })` to it once, instead of letting each `.props` access stay
  implicitly `any`. No change to `layout.tsx`, no assertion value changed.
- `packages/db/src/repositories/README.md` (item 6, doc-only): reworded the garbled
  bare-id-exception sentence in § 1 (role-lock paragraph) to say the method checks the caller
  holds the staff role via `lockRole`, failing with `RepositoryError('scope')` otherwise, and
  never checks for the existence of any other user. Same meaning, readable sentence.

Items 1 (Playwright `--webpack`) and 2 (`ports.ts` double `users.market` read) are wontfix —
see Decisions below. No file outside the plan's "Files to create/modify" list was touched.

## Red-then-green

- Item 3: ran `repositories.int.test.ts`'s `listLiveForStudent` test before the edit — it was
  green against the current `rows` insertion order (as the plan's disposition expected; the
  fragility is about guarantees, not a currently-observed failure). After sorting both sides, the
  same test is green and no longer order-dependent — confirmed via the full gate run below (83
  test files, 1779 passed in `@edmate/db`).
- Item 4: before adding the type guard, `{ 'cache-control': 'public' }` typechecked fine as the
  4th arg (no error) — confirmed by temporarily removing the `& { 'cache-control'?: never }`
  member and running `tsc`, which passed. After adding the guard and the `@ts-expect-error` test
  case, `corepack pnpm turbo run typecheck ... --filter=@edmate/web` is green (the
  `@ts-expect-error` comment itself is what proves the line is now a type error; vitest does not
  execute type-only checks, `tsc` does). The two pre-existing `apiError` tests stayed green
  throughout.
- Item 5: no new runtime assertion; `apps/web` typecheck is green with the new `HtmlElement` cast
  in place (confirmed by the full gate run).
- Item 6: doc-only, no test.

## Decisions

### 26 Oct 2026 · 9.4f Playwright --webpack · decided by builder · risk: low
- Decided: Wontfix. No new board id; point to the existing owner, board task 1.7e ("Turbopack for
  apps/web (1.7b trial)", `status: todo`).
- Why: the real blocker is webpack's dev compile of `@edmate/queue`'s `bullmq` import breaking
  `/api/health` (`next.config.ts` / `packages/queue`), not `playwright.config.ts` itself. 1.7e
  already owns finding and fixing that upstream problem; duplicating it here would split the
  work across two board items for no benefit.

### 26 Oct 2026 · 9.4f ports.ts reads users.market twice · decided by builder · risk: low
- Decided: Wontfix, re-confirmed from 9.4e's disposition; left on the board with no new id.
- Why: `opts.learnerClear(studentId)` and `opts.studentMarket(studentId)` in
  `packages/db/src/repositories/ports.ts` are still two separate `identity` calls on a
  `subscription` resolve, each reading `users.market` (`identity/store.ts`'s `learnerStatus` /
  `getMarket`). A real fix needs a new combined identity method and a reshaped
  `EntitlementStoreOptions`, touching two risky paths (`identity/store.ts`, `ports.ts`) plus 7+
  `packages/db/test` access fixtures, for one extra indexed PK `SELECT` (sub-ms cost). Nothing
  has changed since 9.4e; same reasoning holds.

### 26 Oct 2026 · 9.4f risky paths touched · decided by builder · risk: high
- Decided: this task touches two risky-path globs from `.claude/skills/merge-gate/risk-paths.txt`
  — `apps/web/src/auth/**` (`errors.ts`, item 4) and `packages/db/src/repositories/**`
  (`README.md`, item 6) — so `security-reviewer` (plus `code-reviewer`, always required) must
  review this PR per the group's reviewer requirement, and `review.md` must name them.
- Why: standing rule (CLAUDE.md non-negotiable 6; plan's "Risky paths touched" section) — logging
  this at closeout even though item 6 is doc-only and item 4 is an additive, backward-compatible
  type narrowing with no runtime behaviour change, because both files sit under a risky glob.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`
  (`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate`) — green:
  `Tasks: 13 successful, 13 total`; `@edmate/db:test` → `Test Files 83 passed (83)`,
  `Tests 1779 passed | 4 skipped (1783)`; `@edmate/web` typecheck/lint/test all passed (no
  failures in the run log).
- `corepack pnpm exec prettier --check` on the four changed files — one file needed
  `--write` (`packages/db/test/repositories.int.test.ts`, line-wrapping only); re-ran `--check`
  after → `All matched files use Prettier code style!`.
- `python3 .githooks/secret-scan.py --all` — clean, no output, exit 0.

## Fix round

Fixed two follow-up findings:

- `apps/web/src/auth/errors.ts` (HIGH, security-reviewer + typescript-reviewer; code-reviewer
  MEDIUM): the `{ 'cache-control'?: never }` type guard only blocked the exact lowercase key —
  `{ 'Cache-Control': 'public' }` typechecked, and at runtime the spread kept both keys so
  `Headers` combined them into `cache-control: public, no-store`, letting a caller override the
  intended `no-store`. Replaced the spread with a real `Headers` instance: `new Headers(headers)`
  then `.set('cache-control', 'no-store')`, which replaces any existing entry regardless of case.
  Dropped the now-unneeded `& { 'cache-control'?: never }` type guard and rewrote the doc comment
  to describe the actual guarantee (last-write-wins `Headers.set`, not a compile-time block).
  `errors.test.ts`: replaced the `@ts-expect-error` compile-time test with a runtime test that
  passes `{ 'Cache-Control': 'public, max-age=3600', 'Retry-After': '60' }` and asserts
  `res.headers.get('cache-control')` is exactly `'no-store'` while `Retry-After` still passes
  through.
- `packages/db/src/repositories/README.md` (LOW, typescript-reviewer): reworded the bare-id
  exception sentence — `lockRole` itself returns `Role | null`; it is the calling repository
  method that throws `RepositoryError('scope')` when `lockRole` returns `null`.

### Fix round evidence
- `corepack pnpm turbo run build --filter=@edmate/web^...` — green, `7 successful, 7 total`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — green, `10 successful,
  10 total`.
- `corepack pnpm exec prettier --check` on the three changed files — `All matched files use
  Prettier code style!`.
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget

Tool calls used: 19

Fix round tool calls used: 11
