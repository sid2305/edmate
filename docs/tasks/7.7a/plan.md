# Task 7.7a — 7.7 follow-ups: health report CLI, turn_traces index, negative-path tests

## Acceptance (verbatim)
> the report shows p50/p95 latency (incl. first token), error and guard rates for one teacher
> over a window; the index lands in a migration; invalid limit/since tests fail closed

## How it will be shown
1. A new `packages/db/test/health-report-cli.test.ts` (unit, fake-injected repo, no real db —
   same shape as `verify-teacher-cli.test.ts`/`teacher-questions-cli.test.ts`) proving
   `db:health-report -- --teacher <id> --since <iso> [--limit <n>]` prints p50/p95 latency per
   step (including `firstToken`), the turn-level error rate (with per-step breakdown) and guard
   rate (with per-guard breakdown), computed by piping the fake's rows through
   `computeHealthMetrics`.
2. Two new tests in `packages/db/test/trace-sink.int.test.ts`: `listForTeacherSince` rejects an
   out-of-range `limit` (`0`, `201`) and a malformed `since` (not RFC 3339 with an offset) with
   `RepositoryError('invalid', ...)`, using the file's existing `kind()` helper.
3. A migration (`packages/db/migrations/00XX_*.sql` + its generated `meta/*_snapshot.json` and
   `_journal.json` entry) adding a `(session_id, created_at)` composite index on `turn_traces`,
   proven by every existing `.int.test.ts`'s `migrateDatabase()` call in `beforeAll` continuing to
   pass (this migration has no behavioural assertion beyond "applies cleanly" — there's nothing
   else to test, matching 0008's precedent for `usage_ledger`, which has no dedicated test file
   either).

The PR description shows the CLI unit test's fixture/output pair and the two negative-path
`kind()` assertions.

## Design

### 1. Health report CLI — `packages/db/src/cli.ts`, not `apps/cli`
**Recommendation, overriding the brief's suggested `apps/cli`**: `apps/cli` (`@edmate/cli`) is the
student/dev-facing demo tool (`eval`, `gate`, `content`, `chat`) and does **not** depend on
`@edmate/db` today (checked its `package.json`) — adding a report command there would add a new
cross-package dependency edge for an operator tool that has nothing to do with the demo chat
flow. Edmate already has a dedicated, matching convention for exactly this kind of thing:
`packages/db/src/cli.ts` (`runMigrateCli`, `runGrantRoleCli`, `runVerifyTeacherCli`,
`runTeacherQuestionsCli`) + a thin `packages/db/src/bin/*.ts` entry point + a `db:*` script in
`packages/db/package.json`, each with its own `packages/db/test/*-cli.test.ts` using an
**injected, fakeable `open` function** (not a real db) — see `runTeacherQuestionsCli` /
`OpenTeacherQuestions` (`cli.ts` ~L297-383) for the exact shape to copy. `packages/db/src` already
imports `@edmate/harness` in three other repository files (`corrections.ts`, `chunks.ts`,
`retrieval.ts`) and already depends on it in `package.json`, so importing `computeHealthMetrics`
into `cli.ts` adds no new dependency edge either. This is a smaller, lower-risk, more consistent
change than touching `apps/cli`. Flagged as **Question 1** below since it reverses the brief's
suggestion.

Add to `packages/db/src/cli.ts`:
```ts
export type OpenHealthReport = (url: string) => {
  turnTraces: Pick<Repositories['turnTraces'], 'listForTeacherSince'>;
  close: () => Promise<void>;
};
const openHealthReport: OpenHealthReport = (url) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  return { turnTraces: createRepositories(db).turnTraces, close };
};

export async function runHealthReportCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
  open: OpenHealthReport = openHealthReport,
): Promise<number>
```
- Usage: `db:health-report -- --teacher <id> --since <iso> [--limit <n>]` (`parseArgs`, same style
  as `parseTqArgs`); missing/malformed args print one usage line and return `1`.
- Body: `open(url)`, call `turnTraces.listForTeacherSince({ teacherId: args.teacher }, args.since,
  args.limit)`, pipe the returned rows into `computeHealthMetrics` (imported from
  `@edmate/harness`), print: turn count; for each present `stepLatencyMs` entry (at least
  `firstToken` and `generate` when present) a `p50=.. p95=.. n=..` line; `errorRate` with its
  `errorsByStep` breakdown; `guardRate` with its `guardsByName` breakdown. Exact line text is the
  builder's call (no existing convention to match beyond "one `db:health-report: ...` prefix per
  line, like every other `db:*` command's `log()` calls) — write the test first, then the command,
  same TDD order as every other CLI in this file.
- Errors: catch `RepositoryError` and print a fixed message (never driver text), same pattern as
  `runTeacherQuestionsCli`'s catch block; always `handle?.close()` (check `finally` pattern used by
  neighbouring commands).
- `packages/db/src/bin/health-report.ts` (new): the same 6-line shape as
  `src/bin/verify-teacher.ts`, calling `runHealthReportCli(process.argv.slice(2), process.env,
  console.log)`.
- `packages/db/package.json`: add `"db:health-report": "node dist/bin/health-report.js"` next to
  the other `db:*` scripts.

### 2. `(session_id, created_at)` composite index on `turn_traces`
In `packages/db/src/schema/learning.ts`, `turnTraces`'s index array (~L140-143) gains one entry,
matching `messages_session_id_created_at_idx`'s exact shape (~L113):
```ts
index('turn_traces_session_id_created_at_idx').on(t.sessionId, t.createdAt),
```
alongside the two existing indexes (don't remove `turn_traces_session_id_idx` — a composite index
doesn't always substitute for the single-column one depending on query shape; removing it is a
separate, unnecessary risk this task doesn't need to take).

Run `pnpm --filter @edmate/db db:generate` to produce the migration SQL, `meta/00XX_snapshot.json`
and the `_journal.json` entry (next number after `0028`). Expect a single `CREATE INDEX
"turn_traces_session_id_created_at_idx" ON "turn_traces" USING btree ("session_id","created_at");`
statement — follow migration `0008_usage_ledger_created_at_index.sql`'s exact precedent (plain
`CREATE INDEX`, not `CONCURRENTLY`): the table is pilot-scale (pre-launch, no real traffic yet per
the lead's MVP-first focus) and drizzle's `migrate()` runs every pending file inside one
transaction (`migrate.ts`'s own comment, ~L91), so `CONCURRENTLY` would need the repo's separate
`PostMigrateStep`/`runPostMigrateSteps` mechanism (used once, for migration 0028) — overkill for a
small table with no measured slowness. Flagged as **Question 2** below in case the lead wants the
heavier mechanism anyway.

No dedicated migration int-test file (unlike `sessions-open-unique-migration.int.test.ts` and
similar): those test *behavioural* migrations (new constraints, backfills); this one only adds an
index, which has no behaviour to assert beyond "applies cleanly" — already proven by every
existing `.int.test.ts`'s `beforeAll(() => migrateDatabase(...))` continuing to pass once this
migration is added to the chain.

### 3. Negative-path tests for `listForTeacherSince`
In `packages/db/test/trace-sink.int.test.ts` (already has the `kind()` helper and teacher/session
fixtures from Phase B), add, inside the existing `describe('turnTracesRepo')`-equivalent block (or
alongside the Phase B tests already there):
- `limit: 0` and `limit: 201` each reject with `kind === 'invalid'`.
- `since: 'not-a-date'` (and one that's ISO but missing a UTC offset, e.g. `'2026-10-20T09:00:00'`,
  since the schema is `z.iso.datetime({ offset: true })`) rejects with `kind === 'invalid'`.
No new fixtures or seed changes needed — reuse `own`/`ids` already in that file.

## Files to create
- `packages/db/src/bin/health-report.ts`
- `packages/db/test/health-report-cli.test.ts`
- `packages/db/migrations/00XX_turn_traces_created_at_index.sql` (name from `db:generate`; rename
  the generated file to something this descriptive if `drizzle-kit` picks a random adjective-noun
  name, matching the renamed style of `0008`/`0025`/`0027`)
- `packages/db/migrations/meta/00XX_snapshot.json` (generated, not hand-written)

## Files to modify
- `packages/db/src/cli.ts` — `runHealthReportCli`, `OpenHealthReport`, `openHealthReport`.
- `packages/db/package.json` — new `db:health-report` script.
- `packages/db/src/schema/learning.ts` — new index on `turnTraces`.
- `packages/db/migrations/meta/_journal.json` — generated entry for the new migration.
- `packages/db/test/trace-sink.int.test.ts` — two new negative-path tests.

Roughly 9 files (2 generated, not hand-authored), one package (`packages/db`) — fits one phase.

## Files out of bounds
- `apps/cli/**`, `apps/web/**` — no report surface there; see Design §1 and Question 1.
- `packages/harness/**` — `computeHealthMetrics` is already exported from `@edmate/harness`
  (7.7); not touched here.
- `packages/contracts/**` — not touched; no schema/contract change needed for this task.
- `packages/db/src/repositories/turn-traces.ts` — the repository method, schemas (`Since`,
  `Limit`) and their fail-closed behaviour already exist (7.7); this task only adds tests for
  them, no source change there.
- `packages/harness/src/guardrails/**`, `.../pedagogy/**`, `.../access/**` — not touched.

## Tests first (TDD order)
1. `health-report-cli.test.ts` — red (command doesn't exist), then `runHealthReportCli` +
   `OpenHealthReport`/`openHealthReport` + `bin/health-report.ts` + the `package.json` script.
2. `trace-sink.int.test.ts` — the four negative-path cases (`limit` x2, `since` x2), red against
   the existing (already-correct) schemas only in the sense that the tests don't exist yet; the
   repository behaviour itself already fails closed (7.7), so these are tests proving existing
   behaviour, not driving new production code.
3. Schema index + `db:generate` + rename the migration file — no red/green cycle (it's DDL, not
   logic); verify by re-running the full `.int.test.ts` suite (migrations apply cleanly) and,
   optionally, a `psql`/`pg_indexes` spot-check during the build (not a committed test).

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` — **risky** (listed under "the access filter... keeping each
  teacher's and student's data apart"). Nothing in `turn-traces.ts` itself changes, but this PR's
  `trace-sink.int.test.ts` additions exercise that file's scope-checking path directly (negative
  tests for a teacher-scoped read), and the CLI reads through the same repository. Reviewers
  required: **security-reviewer**. The handoff needs a `risk: high` decision entry.
- `packages/db/src/schema/**`, `packages/db/migrations/**` — not separately listed in
  risk-paths.txt (only migrations that drop/delete data are risky per the file's note, detected by
  `merge_gate.py`, not by path; this migration only adds an index, no drop/delete). Recommend
  **database-reviewer** anyway as good practice (new index, new migration file), matching 7.7's
  own precedent of requesting it voluntarily.
- `packages/db/src/cli.ts`, `src/bin/**` — not listed; standard `code-reviewer`/
  `typescript-reviewer` only.
- `packages/contracts/**`, `.claude/**`, `.githooks/**`, `apps/web/**` — not touched.

## Other tasks in flight — file overlap check
- **8.1b** (`m13/8.1b-verification-followups`, status `review`): touches `packages/db/src/cli.ts`
  (verify/grant-role CLIs: "show the redacted target and accept `--user-id`"), `src/redact.ts`,
  and `src/repositories/teacher-profiles.ts`. **Direct file overlap on `packages/db/src/cli.ts`.**
  8.1b is already in review, not building concurrently — but 7.7a's builder should pull `main`
  immediately before starting (not branch from a stale `main`) so `runHealthReportCli` lands after
  8.1b's edits to the same file, avoiding a merge conflict the lead would otherwise have to
  resolve by hand. No overlap on `redact.ts` or `teacher-profiles.ts` (7.7a doesn't touch either).
- **9.3h / 9.3i** (status `planning`, `apps/web`, maybe `packages/db`): staff queue/lookup rows and
  a student pause/cancel-subscription flow. No named file overlap with 7.7a's list; both are
  `apps/web`-side reads of likely-different repositories (teacher verification/takedowns,
  subscriptions) — if either ends up touching `packages/db/src/repositories/index.ts` or
  `package.json` (new exports/scripts), check for a trivial add-only conflict at merge time, but
  nothing here blocks either from planning or building in parallel.

## Decisions to log (spec doesn't define these — logged on merge, not blocking)
1. **CLI location**: `packages/db/src/cli.ts` + `src/bin/health-report.ts`, not `apps/cli` (see
   Design §1 and Question 1) — reusing the existing operator-CLI convention and avoiding a new
   `apps/cli` → `@edmate/db` dependency edge.
2. **Index creation style**: plain `CREATE INDEX` (not `CONCURRENTLY`), matching migration 0008's
   precedent, because the table is pilot-scale and drizzle's migrator transaction-wraps the file
   (see Question 2 for the alternative).
3. **Exact `db:health-report` output line format** is the builder's call, following the existing
   `db:questions`/`db:verify-teacher` one-line-per-fact convention; not specified further here.
4. **No dedicated migration-only int test file** for the index (see Design §2) — every existing
   `.int.test.ts`'s `migrateDatabase()` call already proves it applies cleanly.

## Open questions
1. **CLI surface: `packages/db/src/cli.ts` (recommended) vs. `apps/cli`.** The task brief suggested
   `apps/cli`, but `apps/cli` doesn't depend on `@edmate/db` today and is scoped to the
   student/dev demo flow (chat/eval/gate/content), not operator tooling. Recommendation: build it
   in `packages/db/src/cli.ts`, matching `db:grant-role`/`db:verify-teacher`/`db:questions`. If the
   lead wants a student- or teacher-facing report instead of an operator one, that's a different,
   larger task (auth, a web page) — out of scope for "once real traffic is known" anyway.
2. **Index creation: plain `CREATE INDEX` (recommended) vs. `CONCURRENTLY` via the repo's existing
   `PostMigrateStep` mechanism** (used once, for migration 0028). Recommendation: plain, since the
   table is empty/small pre-pilot and the heavier mechanism adds complexity with no measured
   benefit yet; revisit if a future migration task finds query-plan evidence it's needed.
3. **Does the composite index belong in 7.7a at all, or should it wait, as the review literally
   said, "once real traffic is known"?** Recommendation: include it here anyway — it's a one-line,
   additive, low-risk schema change with a known query shape already written (7.7's
   `listForTeacherSince` filters on exactly `session_id` join + `created_at` range), so there's no
   reason to wait for traffic data that may not exist before the pilot even starts; the "once real
   traffic is known" framing in the review was about not committing to an index before the query
   existed, not about needing production metrics first. If the lead disagrees, drop Design §2 and
   the migration from this task's scope and leave 7.7a to the CLI + negative tests only (7-ish
   files becomes 6; budget drops by roughly 10 calls).

## Budget: 45 tool calls (1 phase, packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm db:generate, vitest, typecheck/lint/test, secret-scan;
docker compose for the test Postgres; no network/model calls).

## Exit conditions
- **DONE**: `health-report-cli.test.ts` green; the two new `trace-sink.int.test.ts` negative-path
  cases green; the new migration applies cleanly and every other `.int.test.ts` still passes;
  `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` green; secret scan clean;
  handoff logs the `risk: high` decision for the repository-adjacent test changes and the
  CLI-location / index-style decisions above.
- **PARTIAL**: past ~45 tool calls, or a file outside this plan's list needs changing (e.g. the
  repository method itself needs a behaviour change, or `apps/cli` turns out to be the right
  surface after all and needs a new `@edmate/db` dependency) — stop and hand off with what's green
  so far and what's left.

## Lead answers
None yet — this plan has not been reviewed by the lead.

## Lead answers (24 Oct 2026)

Approved as written.
- Q1: yes, the CLI lives in packages/db (`src/cli.ts` plus `src/bin/health-report.ts`), following the existing db CLIs.
- Q2: a plain `CREATE INDEX` is fine; turn_traces is small before the pilot.
- Q3: include the composite index now.
- The build starts only after 8.1b (PR #263) is on main, because both touch `packages/db/src/cli.ts`. Merge origin/main before starting. Use the next free migration number at build time.
- Reviewers on the PR: security-reviewer (repositories group), database-reviewer, code-reviewer, typescript-reviewer.
