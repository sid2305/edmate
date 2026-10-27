# 9.6g plan: EXPLAIN the repositories' real SQL instead of hand-written copies

**Board id note:** `9.6g` is reused (a stale, already-`done` M9 task under the same id —
`m9/9.6g-export-fixes`, "notes PDF bullet"/"answeredPairs" — is unrelated; this plan is for the
M13 entry, deps `9.6f`, title "9.6f database-review follow-ups").

## Acceptance (verbatim)
> the EXPLAIN tests run the repositories' own SQL and assert the index seek for both the lateral
> messages query and the sessions cursor.

Full board title (for the two findings being closed): "`packages/db/test/export-cursor-
paging.int.test.ts` EXPLAINs the real cross join lateral statement `messages.listForStudent`
sends (outer scan stays on the sessions `(teacher_id, student_id)` index, no per-noise-session
lateral), not a hand-written copy (MEDIUM); the mid-range cursor EXPLAIN tests run the SQL the
repositories build instead of parallel hand-written SQL, so a future query edit cannot pass them
while losing the index seek (LOW)."

Shown by: the three hand-written-copy EXPLAIN tests in `export-cursor-paging.int.test.ts`
(messages' full lateral statement; sessions' mid-range cursor; messages' mid-range cursor) are
replaced with versions that capture and EXPLAIN the literal statement + bound params the
repository method actually sends, with no parallel hand-written SQL string.

## How the real SQL is captured (no exported internals, no parallel hand-written copy)
`vi.spyOn(handle.pool, 'query')` — already the established pattern in this package
(`packages/db/test/discovery.int.test.ts`'s "one SQL statement per search" test spies on
`handle.pool.query` the same way, just to count calls). Drizzle's node-postgres driver always
calls `client.query(queryConfig, params)` where `queryConfig.text` is the final SQL string
(confirmed by reading `drizzle-orm/node-postgres/session.js`'s `execute()`), for both the raw
`sql\`...\`` template `messages.listForStudent` uses and the query-builder chain
`sessions.listForStudent` uses — one mechanism covers both repository methods with no `.toSQL()`
export and no second hand-written SQL string:
1. `const spy = vi.spyOn(handle.pool, 'query');`
2. call the real repository method (`repos.messages.listForStudent(...)` /
   `repos.sessions.listForStudent(...)`) — the spy still calls through, so the method's own
   return value is unaffected.
3. `expect(spy.mock.calls).toHaveLength(1);` (sanity: exactly one round trip, so the next step
   EXPLAINs the one statement the method actually sent, not some other query).
4. `const [config, params] = spy.mock.calls[0]; const text = typeof config === 'string' ? config : config.text;`
5. `const { rows } = await raw.query(\`EXPLAIN (FORMAT JSON) ${text}\`, params as unknown[]);` —
   same bound values the repository used, so the plan reflects the real seek.
6. `spy.mockRestore();`

## Files
- `packages/db/test/export-cursor-paging.int.test.ts` (test-only; the only file this task touches)
  - Add `vi` to the existing `from 'vitest'` import.
  - Add a small local helper (e.g. `captureAndExplain(pool, raw, run)`) implementing the 6 steps
    above once, used by the three converted tests below (avoids repeating the spy/restore
    boilerplate three times).
  - Replace **"messages.listForStudent: EXPLAIN on the per-session seek shows no full Sort..."**
    (current lines ~171-190) with a test that captures and EXPLAINs
    `repos.messages.listForStudent(SCOPE, { limit: 2 })`'s real full statement (sessions join +
    lateral + outer order/limit, not just the inner per-session subquery). Assert:
    - the plan contains `messages_session_id_created_at_id_idx` with an `Index (Only)? Scan` (the
      lateral's inner seek, same check as today).
    - the plan's outer scan on `sessions` uses `sessions_teacher_id_student_id_created_at_id_idx`
      with an `Index (Only)? Scan` (new assertion — the MEDIUM's "outer scan stays on the sessions
      `(teacher_id, student_id)` index" point) rather than a seq scan that would run the lateral
      once per `NOISE_SESSION_COUNT` (5,000) unrelated session too.
    - `collectPlannedRows` stays `< MESSAGE_COUNT` as today (no full Sort over the pair's history).
  - Replace **"sessions.listForStudent: a mid-range (page 2+) cursor seeks on the index, no OR
    Filter"** (current lines ~192-211) with a version that calls
    `repos.sessions.listForStudent(SCOPE, { after: { createdAt: '...', id: 'ses_xcur_5' }, limit: 3 })`
    and EXPLAINs the captured real statement; keep the existing assertions (index name, `Index
    Cond` mentions `created_at`, `Filter` undefined).
  - Replace **"messages.listForStudent: a mid-range (page 2+) per-session cursor seeks on the
    index, no OR Filter"** (current lines ~213-229) the same way, calling
    `repos.messages.listForStudent(SCOPE, { after: { createdAt: '...', id: 'msg_xcur_120' }, limit: 3 })`
    and keeping its existing assertions.
  - The unconverted first test ("sessions.listForStudent: EXPLAIN shows an index scan with no full
    Sort over the pair", lines ~157-169) and the two non-EXPLAIN paging-correctness tests (the
    cross-session tie and the full-history page-by-page match) are **not** touched — neither
    finding names them, and they already run the real repository method, not a hand copy, where
    it matters (the tie/page-by-page tests call `repos.*.listForStudent` directly with no SQL
    string at all).

## Not in scope / don't touch
- No production code change: `packages/db/src/repositories/messages.ts` and `sessions.ts` are
  already correct (9.6f's HIGHs); this task is test coverage/quality only. If EXPLAINing the real
  statement turns up an actual regression (e.g. the outer scan is a seq scan), stop and report
  back as a finding rather than silently fixing the repository under this test-only plan.
  **A fix in `packages/db/src/repositories/**` would make this a risky-path PR** (reviewers:
  `security-reviewer`, `database-reviewer`, `code-reviewer`, `typescript-reviewer`, plus a
  `risk: high` decision) — out of this plan's budget; hand back instead.
- No change to `packages/db/test/pg.ts` or any other shared test helper file.
- Nothing under `packages/db/src/schema/users.ts`, migrations, `migrate.ts`, `teacher-
  profiles.ts`, `role-lock.ts`, `leak.test.ts`, `scope.test.ts`, or a new `teacher-profiles-
  pending-index.int.test.ts` — all owned by the concurrent 12.1c Phase A builder in the same
  package.
- No `packages/contracts` change.

## Tests first
1. Before editing, run the current `export-cursor-paging.int.test.ts` suite green (confirms the
   baseline and that Postgres is reachable per `test/pg.ts`'s instructions).
2. Convert the three tests one at a time. After each conversion, run it alone and confirm:
   - `spy.mock.calls` has length 1 (proves the capture isolated the one real statement, not a
     stray query) — if this is ever more than 1, the test must fail loud, not silently EXPLAIN
     the wrong call.
   - the captured `text` string actually contains the expected real-statement fragment (`cross
     join lateral` for the messages tests, the row-value `>` cursor compare for the two mid-range
     tests) — a quick sanity check that the spy really captured the repository's own SQL and not
     an empty/unrelated string, before trusting the EXPLAIN assertions that follow.
   - the EXPLAIN assertions (index names, `Index (Only)? Scan`, no `Filter`, planned-rows bound,
     and the new outer-sessions-index assertion for the messages test) pass.
3. Re-run the whole file; confirm the two untouched tests and the two paging-correctness tests are
   still green and unchanged.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
None (checked against risk-paths.txt): `packages/db/test/**` matches no entry — only
`packages/db/src/repositories/**` and `packages/db/src/identity/**` are listed, and this task
touches neither. No `risk: high` decision needed for this PR as planned.

## Gate
```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=@edmate/db
```
Plus `corepack pnpm exec prettier --check` on the changed test file and
`python3 .githooks/secret-scan.py --all`.

## Open questions
- None on scope/spec: both findings (MEDIUM + LOW) name a concrete, bounded test-only fix; no new
  decision needed. The id collision with the stale, already-`done` M9 `9.6g` is noted above, not a
  blocker.

## Budget
Budget: 30 tool calls (1 phase, @edmate/db)

## Allowed tools
Read, Grep, Glob, Edit, Bash (tests, typecheck/lint, prettier --check, secret-scan only)

## Exit conditions
Status: DONE when all three converted EXPLAIN tests are green against the real captured
statement (including the new outer-sessions-index assertion on the messages test), the rest of
`export-cursor-paging.int.test.ts` is unaffected and green, and the gate above is clean.
Status: PARTIAL past ~35 tool calls, or if EXPLAINing the real statement surfaces an actual
repository-code regression (stop and hand back rather than editing
`packages/db/src/repositories/**` under this plan).
