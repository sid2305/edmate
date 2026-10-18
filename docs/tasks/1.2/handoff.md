# 1.2 handoff: Repositories scoped by teacher and by student

Status: DONE
Branch: `m1/1.2-scoped-repositories`
Worktree: `.claude/worktrees/agent-aeb973dde1c058d10`
Risky: yes, `packages/db/src/repositories/**`. Reviewers: `security-reviewer` (required), plus
`database-reviewer` and `typescript-reviewer` (lead's request). `client.ts`, `index.ts` and
`internal.ts` carry isolation weight too (the narrowed package surface). No migration.

## Acceptance evidence

Accept: "cross-teacher and cross-student reads and writes fail closed in tests."

Postgres: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`
(pinned `pgvector/pgvector:0.8.1-pg16` on 127.0.0.1:55432), stopped after. Each suite uses its own
throwaway database.

| Part | Evidence |
|---|---|
| Cross-teacher and cross-student **reads** fail closed | `test/repositories.int.test.ts`: every read method, every actor x every target (teachers A, B; pairs 1A, 1B, 2A, 2B); positive control (actor = owner) returns only the owner's markers; any other actor gets `null` / `[]`; plus 20 seeded-random ids per read method. Summary below, leaks = 0 everywhere. |
| Cross-teacher and cross-student **writes** fail closed | Same test: every write aimed at another scope's target, or carrying another scope's ids, throws `RepositoryError` (`not_found` or `scope`) and the `count(*)` and `max(updated_at)` of all 36 tables are unchanged. Payload mismatches (another teacher's modules / topics / similar questions / agent, mixed good+bad evidence batch) throw `scope` / `not_found` and write nothing. Positive writes are readable by the owner and nobody else. |
| No method is missed | `CASES: Record<RepositoryMethod, IsolationCase>`. Checked by adding a dummy `subscriptions.probeExtra` method: `tsc` → `error TS2741: Property '"subscriptions.probeExtra"' is missing in type … 'Record<RepositoryMethod, IsolationCase>'` (then removed). At runtime the test compares the methods on `createRepositories(db)` with `CASES` keys. `test/scope.test.ts` also enumerates methods at runtime. |
| Bad scope never reaches SQL | `test/scope.test.ts` (no DB, pool on `127.0.0.1:1`): all 16 methods × 11 bad scopes (`undefined`, `null`, string, `{}`, `''` ids, SQL in id, 129-char id, `undefined` ids, array, extra key on each scope kind) → `RepositoryError` `scope` with the method name; `transcriptStoreFor` rejects at construction. Static: no `sql.raw(`, `.delete(`, `delete from` or `users` under `src/repositories/*.ts`. |
| 1.1 deferrals | (a) `test/types.test.ts` `expectTypeOf` (typed jsonb columns = contract types; return types; `TeacherQuestionForTeacher = Omit<TeacherQuestion,'studentId'>`; `transcriptStoreFor` returns `TranscriptStore`). `drizzle-kit generate` → `No schema changes, nothing to migrate`. (b) messages and turn traces: join on `sessions` for reads, `INSERT … SELECT … FROM sessions WHERE <scope>` for writes (`ownSession()` in `sessions.ts`). (c) `test/client.test.ts`: defaults, each env var, 12 out-of-range / non-integer values throw, error handler registered and redacts, migrator `{ max: 1, statement_timeout: false }`. |

Method list and per-method summary (`corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...`):
```
[isolation] 16 methods: agentVersions.get, evidenceEvents.append, learnerProfiles.get, learnerProfiles.save, messages.append, messages.history, packageVersions.create, packageVersions.get, sessions.create, sessions.get, subscriptions.findLive, teacherQuestions.listForStudent, teacherQuestions.listForTeacher, teacherQuestions.open, turnTraces.insert, turnTraces.listForSession
[isolation] per method:
  agentVersions.get                  teacher read  cases=24 leaks=0
  packageVersions.get                teacher read  cases=24 leaks=0
  packageVersions.create             teacher write cases=16 leaks=0
  teacherQuestions.listForTeacher    teacher read  cases=22 leaks=0
  sessions.create                    student write cases=20 leaks=0
  sessions.get                       student read  cases=36 leaks=0
  messages.history                   student read  cases=36 leaks=0
  messages.append                    student write cases=20 leaks=0
  turnTraces.insert                  student write cases=20 leaks=0
  turnTraces.listForSession          student read  cases=36 leaks=0
  learnerProfiles.get                student read  cases=24 leaks=0
  learnerProfiles.save               student write cases=20 leaks=0
  evidenceEvents.append              student write cases=32 leaks=0
  subscriptions.findLive             student read  cases=24 leaks=0
  teacherQuestions.open              student write cases=24 leaks=0
  teacherQuestions.listForStudent    student read  cases=24 leaks=0
@edmate/db:test:  Test Files  7 passed (7)
@edmate/db:test:       Tests  140 passed (140)
@edmate/db:test: All files          |     100 |    99.15 |     100 |     100 |
@edmate/db:test:  src/repositories  |     100 |      100 |     100 |     100 |
 Tasks:    11 successful, 11 total
```
Specific checks in the same file: `listForTeacher` rows have no `studentId` key and no `stu_` text;
`history` returns oldest first, keeps the newest `limit`, ties ordered by id, rejects 0 / 201 / 1.5 / -1
with `invalid`; `transcriptStoreFor(1A)` reads nothing from and cannot append to the other three
sessions; corrupted rows (package config naming another teacher, invalid agent config, valid agent
config naming another teacher, malformed message sources) throw `integrity`; ghost scope ids
(not users) → `not_found`; ended subscriptions are not live; optional fields round-trip and are
omitted when absent.

No Postgres (local skip path): `TEST_DATABASE_URL=postgres://u:p@127.0.0.1:1/x CI= vitest run --coverage`
→ `5 passed | 2 skipped`, `107 passed | 33 skipped`, both SKIPPED messages printed, coverage passes
(repositories left out of coverage only in this mode; see Decisions).

Root gates after merging origin/main (`corepack pnpm install --frozen-lockfile && corepack pnpm turbo run build typecheck lint test`):
```
 Tasks:    40 successful, 40 total
```
`python3 -m unittest discover .claude/tests` → `Ran 122 tests … OK`.
`python3 .githooks/secret-scan.py --all` → exit 0. `prettier --check packages/db` → clean.

TDD: `scope.test.ts`, `types.test.ts`, `repositories.int.test.ts`, the client tests and the seed
were written first and ran red (`Cannot find module '../src/internal.js'`, `createRepositories is not
a function`, `poolOptions is not a function`); then errors → scope → map → repositories → ports →
index/internal → client. Two int failures on the first green run were fixed (a `text[]` parameter
binding bug in `teacherQuestions.open`, and a test that counted evidence too broadly).

## Changes

- `packages/db/src/repositories/` (new): `errors.ts` (`RepositoryError` kind/code/method,
  `translateWrite`: FK violation → `not_found`, unique violation → `invalid`, others rethrown),
  `scope.ts` (scope parsers picked from `LearnerProfileSchema`), `insert.ts` (`insertSelect`,
  built with `sql` templates and `sql.identifier`, no `sql.raw`), `map.ts` (row → contract, parsed),
  `agent-versions.ts`, `package-versions.ts`, `sessions.ts` (+ `ownSession`), `messages.ts`,
  `turn-traces.ts`, `learner.ts` (profiles, evidence), `subscriptions.ts`, `teacher-questions.ts`,
  `ports.ts` (`transcriptStoreFor`), `index.ts` (`createRepositories`, `RepositoryMethod`), `README.md`.
- `src/index.ts`: root export narrowed to `openDatabase`, repositories, scope parsers/types,
  `RepositoryError`, `migrateDatabase`, `MIGRATIONS_DIR`. New `src/internal.ts` (`createDb`,
  `poolOptions`, `Db`, schema) and `package.json` `exports["./internal"]`.
- `src/client.ts`: `poolOptions(env, overrides)` with the four env settings (defaults, ranges,
  throw on invalid), fixed `idle_in_transaction_session_timeout` 30 s and `application_name`,
  `pool.on('error')` writing one redacted line. `src/redact.ts` (moved from `cli.ts`).
  `src/migrate.ts`: `MIGRATE_POOL_OPTIONS = { max: 1, statement_timeout: false }`.
- `src/schema/agents.ts`, `learning.ts`: `.$type<>()` on `agent_versions.config`,
  `package_versions.config`, `messages.sources`, `turn_traces.steps`, `learner_profiles.mastery` /
  `mistakes` (TypeScript only).
- `package.json`: `@edmate/contracts` and `zod` moved to `dependencies` (same pins); description.
  `vitest.config.ts`: async config; `src/repositories/**` threshold 100/100/90/100 when the
  integration suite runs.
- Tests: `test/pg.ts` (shared Postgres helpers, from `migrate.int.test.ts`), `isolation-seed.ts`,
  `repositories.int.test.ts`, `scope.test.ts`, `types.test.ts`, `errors.test.ts`; `client.test.ts`
  extended; `migrate.int.test.ts` uses `pg.ts` and a fixture package config.
- `docker/env.example`: the four pool variables, commented, with defaults and ranges.
- `pnpm-lock.yaml`.

## Deviations from the plan

- `teacherQuestions.listForStudent` returns at most the newest 200 (plan had no limit), to avoid
  an unbounded read. `teacherQuestions.open` requires non-blank text of at most 8,000 characters
  (`LIMITS.turnTextMaxLength`); the contract allows any string.
- `teacherQuestions.open` stamps `created_at` in the app (not the DB default) so the returned
  `TeacherQuestion` matches the row without a second read; `messages.append` stores the message's
  own `createdAt`.
- `sessions.get` returns `SessionRow` (no contract type exists) including `helpState: unknown`.
- Extra files not in the plan: `insert.ts`, `redact.ts`, `test/errors.test.ts`.
- The repository coverage threshold is decided by probing Postgres in `vitest.config.ts` rather
  than a vitest global setup (same effect as plan Q3, simpler).

## Notes for later tasks

- 1.3: add `no-restricted-imports` for `@edmate/db/internal` in `apps/**` when an app imports
  `@edmate/db`.
- 3.2 / 5.10 / 6.2 / 2.4 / 3.8 / 7.7 / 5.3: their port adapters and any new methods need isolation
  cases (the compiler will insist). `usage_ledger` and `turn_traces` need additive migrations for
  the contract fields (see plan § Ports).
- 3.8: message order ties are broken by id (no sequence column).

## Decisions

### 18 Oct 2026 · 1.2 Isolation enforced by required scopes in the repositories · decided by planner · risk: high
Decided: Every repository method takes a validated `TeacherScope` or `StudentScope` first and puts it in the WHERE clause of the same statement; messages and turn traces are scoped through a join on `sessions`; another scope's row reads as missing (`null`/`[]`) and writes to it throw `not_found`; frozen ports without a scope parameter (`TranscriptStore`) are bound to a scope at construction; the root `@edmate/db` export has no raw database handle or schema (`@edmate/db/internal` is for migrations, seed and tests). A typed case table makes the isolation test fail to compile when a method has no case.
Why: Data model rule "repositories require the right scope"; no RLS (1.1 decision); ports are frozen (ADR-0002).
Alternatives: Postgres RLS; changing the ports to take a scope (ADR); scope checks in the web layer only.
Reversible: Yes, but every caller binds scopes this way from 1.3 on.

### 18 Oct 2026 · 1.2 Pool limits from env, invalid values throw · decided by planner · risk: low
Decided: `DATABASE_POOL_MAX` (10, 1..100), `DATABASE_IDLE_TIMEOUT_MS` (30 000), `DATABASE_CONNECT_TIMEOUT_MS` (5 000), `DATABASE_STATEMENT_TIMEOUT_MS` (15 000); fixed idle-in-transaction timeout 30 s and `application_name=edmate`; an invalid value throws at startup; the migrator uses one connection and no statement timeout; idle client errors are logged redacted, not thrown.
Why: 1.1 review deferral (c); a silent default would hide a misconfiguration.
Alternatives: No limits (pg defaults); clamping bad values.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Typed jsonb columns, parsed on read · decided by planner · risk: low
Decided: `.$type<>()` ties `agent_versions.config`, `package_versions.config`, `messages.sources`, `turn_traces.steps`, `learner_profiles.mastery`/`mistakes` to contract types (no migration); every row leaving a repository is parsed with its contract schema and a mismatch with its own columns throws `integrity`. `sessions.help_state`, `eval_results.details`, `insights.payload`, `audit_log.before/after` and trust `staff_actions` stay `unknown` until their owners (3.5, 7.x, 11.3, 1.6, 12.x).
Why: 1.1 review deferral (a); a corrupted or mis-owned row must never be returned.
Alternatives: Trust stored jsonb.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Contracts and zod become runtime dependencies of @edmate/db · decided by planner · risk: low
Decided: `@edmate/contracts` (workspace) and `zod` 4.6.7 move from devDependencies to dependencies.
Why: Repositories parse scopes, inputs and rows at runtime.
Alternatives: Hand-written validators.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Exhaustive grid instead of a property-testing library · decided by planner · risk: low
Decided: The isolation test enumerates every actor x target over a two-teacher, two-student seed plus 20 seeded-random ids per read method; no new dependency.
Why: The seed is small enough to cover every combination exactly.
Alternatives: fast-check.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Message history ties ordered by id · decided by planner (lead accepted) · risk: low
Decided: `history` orders by `(created_at desc, id desc)` and returns the page oldest first; no sequence column.
Why: Lead answer Q4; the pipeline gives student and agent messages different timestamps.
Alternatives: An additive `bigserial seq` migration.
Reversible: Yes (3.8 may add a sequence).

### 18 Oct 2026 · 1.2 RepositoryError kinds and codes; constraint violations translated · decided by tdd-guide · risk: low
Decided: `scope` → `forbidden`, `not_found` → `not_found`, `invalid` → `validation`, `integrity` → `validation`. Writes translate a foreign-key violation to `not_found` (for example a scope id that is not a user) and a unique violation to `invalid` (an existing immutable version or message id); all other driver errors propagate. Messages carry the method and kind only.
Why: Driver messages quote row values (ids, text); a public repo's logs must not carry them.
Alternatives: Pass driver errors through; a separate `conflict` kind.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Ownership checks: INSERT … SELECT, or KEY SHARE check plus insert in one transaction · decided by tdd-guide · risk: low
Decided: Single-owner writes (sessions, messages, turn traces, package versions, teacher questions) are `INSERT … SELECT … FROM <owner> WHERE <scope>` built with `sql` templates and explicit casts. Set checks (package `moduleIds`, evidence `topicId`s, question `similarIds`) select the ids `FOR KEY SHARE` in the same transaction; any id that is missing or another teacher's makes the whole write fail with `scope`.
Why: Drizzle's `insert().select()` needs every column in table order; the template keeps the scope and the insert in one statement without `sql.raw`.
Alternatives: Check then insert without a lock.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Repository coverage enforced only when the integration suite runs · decided by planner (lead accepted) · risk: low
Decided: `vitest.config.ts` probes Postgres (or `CI=true`); when the suite runs, `src/repositories/**` must have 100% lines, functions and statements and 90% branches; otherwise that folder is left out of coverage so local runs without Docker stay green. CI always runs it.
Why: Lead answer Q3.
Alternatives: Always enforce (red without Docker); never enforce.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Small API limits not in the spec · decided by tdd-guide · risk: low
Decided: `teacherQuestions.listForStudent` returns at most the newest 200; `listForTeacher` takes a required `status` and a `limit` of 1..200; `teacherQuestions.open` rejects blank text and text over 8,000 characters; `sessions.get` returns a `SessionRow` with `helpState: unknown`.
Why: Bounded reads and no empty questions in a teacher's inbox.
Alternatives: Unbounded lists; accept any string.
Reversible: Yes.
