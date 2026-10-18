# 1.2 plan: Repositories scoped by teacher and by student

Board: `board.py show 1.2` · Milestone M1 · deps: 1.1 (done), M0 (done) · branch `m1/1.2-scoped-repositories` · risk: **risky** (`packages/db/src/repositories/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Repositories scoped by teacher and by student"
Accept: "cross-teacher and cross-student reads and writes fail closed in tests."

Spec it must honour:
- Build plan § Data model: "Teacher-owned rows carry `teacher_id`; student rows carry `student_id`; repositories require the right scope. Student display names never go to models."
- Build plan § Tech stack: "Every teacher-owned row carries `teacher_id`; student data scoped by `student_id`."
- ADR-0002: ports are type-only in `packages/contracts/src/ports.ts`; `db` implements them by importing contracts. The ports are frozen (rule 2), so 1.2 changes no port signature.
- Decision log 18 Oct 2026, "1.1 Isolation in repositories, not RLS": isolation is enforced here, not by Postgres RLS.
- 1.1 review deferrals (`docs/tasks/1.1/review.md`): (a) `.$type<>()` on jsonb columns tied to contract types, plus checks where rows map to contract shapes; (b) messages and turn traces scoped through a join on `sessions`; (c) pool `max`, idle and statement timeouts.
- `teacher_questions.student_id` "is stored but hidden from the teacher by the read layer (1.2+)" (schema comment; build plan § Ask the teacher, step 2).

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| Cross-teacher and cross-student **reads** fail closed | `test/repositories.int.test.ts` on real Postgres 16 + pgvector: for every read method, every actor scope × every target owned by someone else returns `null` / `[]`; the positive control (actor = owner) returns the owner's rows. Paste the per-method summary line the test prints (method, cases run, leaks = 0). |
| Cross-teacher and cross-student **writes** fail closed | Same test: every write method aimed at another scope's target, or carrying another scope's ids in its payload, throws `RepositoryError` (`scope` or `not_found`) and leaves every table's row count and `max(updated_at)` unchanged. |
| No method is missed | Compile-time: the isolation case table is typed `Record<RepositoryMethod, IsolationCase>`, so a new method without a case fails `tsc`. Runtime: the test compares the method names found on `createRepositories(db)` with the case table's keys, both ways. Paste the method list. |
| Bad scope never reaches SQL | `test/scope.test.ts` (unit, no DB): every method called with `undefined`, `{}`, `''` ids, an id failing the contracts' id format, or an extra key throws a `scope` error, against a pool pointed at an unreachable host (so any query attempt would surface as a connection error instead). |
| 1.1 deferrals | (a) `expectTypeOf` checks in `test/types.test.ts` (fail `tsc` on drift); `drizzle-kit generate` prints "No schema changes" (`.$type` is TypeScript-only). (b) messages/traces queries join `sessions` (int test cases above + code). (c) `test/client.test.ts` asserts the pool options and that bad env values throw. |
| Gates | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...` with Postgres up (compose override from 1.1); coverage of `src/repositories/**` pasted. Secret scan clean. |

## Design

### Principles (go in `src/repositories/README.md` too)
1. **Scope first, always required.** Every repository method's first parameter is a scope: `TeacherScope = { teacherId }` or `StudentScope = { studentId, teacherId }` (student data in Edmate is always per student × teacher: sessions, profiles, evidence, subscriptions, questions). No method has an optional scope or an overload without one.
2. **Validated at runtime before any SQL.** `teacherScope(x)` / `studentScope(x)` parse with Zod schemas built from contracts without changing them: `LearnerProfileSchema.pick({ studentId: true, teacherId: true })` and `.pick({ teacherId: true })` (strict, id format). This matters because Drizzle's `and()` silently drops `undefined` conditions, so an unvalidated `undefined` id would widen a query. Failure throws `RepositoryError('scope')`.
3. **Scope is in the WHERE clause of the same statement** that reads or writes. Ownership checks for writes are atomic: `INSERT … SELECT … FROM <owner table> WHERE id = $x AND teacher_id = $t [AND student_id = $s]` (zero rows inserted → `not_found`), or a check plus insert inside one transaction when a set of ids must all belong to the teacher.
4. **Messages and turn traces are scoped through `sessions`.** Reads: `messages JOIN sessions ON sessions.id = messages.session_id WHERE messages.session_id = $id AND sessions.student_id = $s AND sessions.teacher_id = $t`. Writes: `INSERT INTO messages … SELECT … FROM sessions WHERE id = $id AND student_id = $s AND teacher_id = $t`.
5. **Fail closed without an existence oracle.** Another scope's row and a missing row look the same: reads return `null` / `[]`, writes throw `RepositoryError('not_found')`. Payload ids that disagree with the scope (for example `profile.studentId !== scope.studentId`) throw `RepositoryError('scope')` before SQL. Error messages name the method only, never ids, row content or student text (rule 5).
6. **Rows leave as contract shapes, parsed.** Mappers turn rows into contract types and parse them with the contract schema; a stored row that fails (or whose jsonb `teacherId`/`id`/`version` disagrees with its columns) throws `RepositoryError('integrity')`. Absent optional fields are omitted, never `undefined` (`exactOptionalPropertyTypes`).
7. **Ownership columns are immutable.** No repository method updates `teacher_id`, `student_id` or `session_id`; 1.2 has no delete methods (retention 13.4, memory reset 6.5).
8. **No raw SQL strings.** No `sql.raw(` and no `.delete(` under `src/repositories/` (a static test reads the folder and fails on either).
9. **Never returns `users.name`, `email` or `phone`.** No 1.2 method selects from `users`.

### `RepositoryError`
`src/repositories/errors.ts`: one class, `kind: 'scope' | 'not_found' | 'invalid' | 'integrity'`, plus `code: ErrorCode` from contracts (`forbidden`, `not_found`, `validation`, `validation`), and `method: string`. `invalid` covers bad non-scope input (for example `limit` outside 1..200).

### What 1.2 builds: methods (16) and one port adapter
All under `packages/db/src/repositories/`. `createRepositories(db)` returns a plain object of plain objects of functions (so the test can enumerate them).

| Repo · method | Scope | Read/write | Isolation detail |
|---|---|---|---|
| `agentVersions.get(scope, { agentId, version })` → `AgentConfig \| null` | Teacher | R | `agent_versions.teacher_id = $t`; parsed config must have `teacherId = $t`, `id = agentId`, `version` |
| `packageVersions.get(scope, { packageId, version })` → `PackageConfig \| null` | Teacher | R | same pattern |
| `packageVersions.create(scope, config: PackageConfig)` → `void` | Teacher | W | `config.teacherId = $t` (else `scope`); package row owned by `$t` with `agent_id = config.agentId`; **every `moduleIds` entry is a module of `$t`** (a package can never unlock another teacher's material); immutable insert, unique `(package_id, version)` |
| `teacherQuestions.listForTeacher(scope, { status, limit })` → `TeacherQuestionForTeacher[]` | Teacher | R | `TeacherQuestionForTeacher = Omit<TeacherQuestion, 'studentId'>`; the SELECT lists columns and never selects `student_id` |
| `sessions.create(scope, { agentId, agentVersion })` → `{ id }` | Student | W | `INSERT … SELECT` from `agent_versions JOIN agents` where the agent is `$t`'s and the version exists |
| `sessions.get(scope, sessionId)` → `SessionRow \| null` | Student | R | `id`, `student_id`, `teacher_id` all in WHERE |
| `messages.history(scope, sessionId, limit)` → `Message[]` | Student | R | session join (principle 4); newest `limit` by `created_at desc, id desc`, returned oldest first; `limit` 1..200 |
| `messages.append(scope, sessionId, m: Message)` → `void` | Student | W | `INSERT … SELECT FROM sessions` (principle 4); `m` parsed with `MessageSchema` |
| `turnTraces.insert(scope, sessionId, row)` → `void` | Student | W | session join; `row` = the table's columns (`steps`, `model`, tokens, `costMicroUsd`), `steps` parsed with `TurnTraceSchema.shape.steps` |
| `turnTraces.listForSession(scope, sessionId)` → trace rows | Student | R | session join |
| `learnerProfiles.get(scope)` → `LearnerProfile \| null` | Student | R | unique `(teacher_id, student_id)` |
| `learnerProfiles.save(scope, profile: LearnerProfile)` → `void` | Student | W | `profile.studentId/teacherId` must equal scope (else `scope`); upsert `ON CONFLICT (teacher_id, student_id)` |
| `evidenceEvents.append(scope, events: EvidenceEvent[])` → `void` | Student | W | each event's ids equal scope; every `topicId` is a topic of `$t`, checked in the same transaction (mismatch → rollback, `scope`) |
| `subscriptions.findLive(scope)` → `LiveSubscription \| null` | Student | R | `status <> 'ended'`; returns `{ id, packageVersionId, status, periodEnd }` |
| `teacherQuestions.open(scope, { agentId, text, moduleHint?, similarIds })` → `TeacherQuestion` | Student | W | agent owned by `$t` (`INSERT … SELECT`); every `similarIds` entry is a question of `$t` |
| `teacherQuestions.listForStudent(scope)` → `TeacherQuestion[]` | Student | R | `student_id` and `teacher_id` in WHERE |

Port adapter: `transcriptStoreFor(repos, scope: StudentScope): TranscriptStore` (in `src/repositories/ports.ts`), a thin binding of `messages.history` / `messages.append`. The `TranscriptStore` port has no scope parameter and is frozen, so the scope is a **required constructor argument**: the caller (web route or worker, from the signed-in student and the agent's teacher) builds one store per turn. The type-level check `transcriptStoreFor(...) satisfies TranscriptStore` plus an int case proves it.

### Ports: now vs later (do not build the later ones)
| Port | 1.2 | Owner | Note for the owner |
|---|---|---|---|
| `TranscriptStore` | **Adapter now** | 1.2 | Used by 3.4 (`buildContext`) and 3.8 (`commit`) |
| `EntitlementStore.resolve` | Reads only (`subscriptions.findLive`, `packageVersions.get`) | 3.2 | Needs subscription, teacher-preview and eval semantics and "locked = teacher's modules − allowed" (adds `modules.list(teacherScope)` with its isolation case) |
| `ProfileStore` | Reads/writes only (`learnerProfiles.get/save`, `evidenceEvents.append`) | 6.2 | `applyEvidence` is BKT; `get` must return a default profile (needs a `lang` rule) |
| `TeacherQuestionStore` | `open` / list methods only | 5.10 | `findSimilar` and grouping are 5.10's logic; its `open` adapter asserts `q.studentId/teacherId` equal the bound scope |
| `CorrectionStore` | none | 5.10 | Writes a teacher-note chunk + eval case |
| `UsageMeter` | none | 2.4 | `usage_ledger` has no `turn_id` or `source` column: 2.4 needs an additive migration |
| `TraceSink` | Table-shaped insert/list only | 3.8 / 7.7 | `TurnTrace` has `turnId`, `agentVersion`, `packageVersion`, `intent`, `move`, `guards`, `usage[]`; `turn_traces` has none of these except `steps`: an additive migration is needed |
| `RetrievalIndex` | none | 5.3 / 5.4 | Lives under `repositories/` too (security-reviewer); must add its isolation cases |
| `AlertSink`, `ModelGateway`, `Guard`, `Tool` | none | 4.3, 2.2/2.3, harness | — |

Any later task that adds a repository method gets a compile error until it adds an isolation case: that is the mechanism that keeps "no unscoped path" true after 1.2.

### Package surface: no unscoped path from outside the package
Nothing outside `packages/db` imports `@edmate/db` yet, so narrowing it now is free:
- Root `@edmate/db` (`src/index.ts`): `openDatabase(env)` → `{ repos, close }`, `createRepositories`, `transcriptStoreFor`, scope parsers and types, `RepositoryError`, `migrateDatabase`, `MIGRATIONS_DIR`. **No schema tables and no raw Drizzle handle.**
- New subpath `@edmate/db/internal` (`src/internal.ts`, `package.json` `exports`): `createDb`, `Db`, schema. Documented as "migrations, seed (1.5) and tests only". A lint rule forbidding it in `apps/**` comes when an app first imports the package (1.3); noted for 1.3 (see Q2).

### 1.1 deferral (a): typed jsonb and compile-time shape checks
`.$type<>()` (TypeScript only; no migration):
- `agent_versions.config` → `AgentConfig`; `package_versions.config` → `PackageConfig`
- `messages.sources` → `SourceRef[]` (nullable)
- `turn_traces.steps` → `TurnTrace['steps']`
- `learner_profiles.mastery` → `LearnerProfile['mastery']`; `mistakes` → `LearnerProfile['mistakes']`
- Left as `unknown` (no contract type; owners noted): `sessions.help_state` (3.5), `eval_results.details` (7.x), `insights.payload` (11.3), `audit_log.before/after` (1.6), trust `staff_actions` (12.x).

`test/types.test.ts` (`expectTypeOf`, checked by `tsc` since `tsconfig.json` covers `test/`): each typed column's `$inferSelect` type equals the contract type; each mapper's return type equals the contract type (`Message`, `LearnerProfile`, `TeacherQuestion`, `AgentConfig`, `PackageConfig`, `TeacherQuestionForTeacher` = `Omit<TeacherQuestion,'studentId'>`); `transcriptStoreFor` returns `TranscriptStore`. Runtime: mappers also parse with the contract schema (principle 6).

`packages/db/package.json`: `@edmate/contracts` and `zod` move from devDependencies to **dependencies** (repositories parse at runtime). Same pinned versions; lockfile updates.

### 1.1 deferral (c): pool limits (`src/client.ts`)
`createDb(env, overrides?)` reads optional env, parsed with Zod (an invalid value throws; no silent default):
| Env | Default | Range | pg option |
|---|---|---|---|
| `DATABASE_POOL_MAX` | 10 | 1..100 | `max` |
| `DATABASE_IDLE_TIMEOUT_MS` | 30 000 | 1 000..600 000 | `idleTimeoutMillis` |
| `DATABASE_CONNECT_TIMEOUT_MS` | 5 000 | 500..60 000 | `connectionTimeoutMillis` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 15 000 | 100..600 000 | `statement_timeout` |
| (fixed) | 30 000 | — | `idle_in_transaction_session_timeout` |
| (fixed) | `edmate` | — | `application_name` |

Plus `pool.on('error', …)` so an idle client error does not crash the process; it writes one line without the connection string (same redaction as `cli.ts`). `migrateDatabase` passes `max: 1` and statement timeout `0` (off) so a long future migration (HNSW index, 5.3) is not killed. `docker/env.example` lists the four variables, commented, with defaults.

## Tests first (TDD: red, then green)

Shared test helper: move `reachable`, `admin`, throwaway-database create/drop and the skip/CI-fail logic from `migrate.int.test.ts` into `test/pg.ts`; both int files use it (same behaviour: skip locally with the message, fail when `CI=true`).

1. **`test/scope.test.ts`** (unit, no DB). Scope parsers accept valid ids; reject `undefined`, `{}`, `''`, `"x' or 1=1"`, 129-char ids, extra keys. Then, table-driven over every repository method: a bad scope throws `RepositoryError('scope')` against a pool on `127.0.0.1:1` (a query attempt would surface as a connection error). Static check: no `sql.raw(` or `.delete(` under `src/repositories/`.
2. **`test/types.test.ts`**: the `expectTypeOf` checks above.
3. **`test/client.test.ts`** (extend): defaults applied; each env var honoured; out-of-range or non-integer values throw; pool error handler registered; migrate uses `max: 1`, no statement timeout.
4. **`test/repositories.int.test.ts`** (real Postgres; the acceptance test).
   - **Seed** (`test/isolation-seed.ts`, raw Drizzle via `@edmate/db/internal`, synthetic ids such as `tch_a`, `stu_a`, no personal data): teachers A and B; students 1 and 2; per teacher a course, two modules, a topic, a style card, an agent with version 1 and a package with version 1 (configs built from `@edmate/contracts/fixtures` `demoAgentConfig` / `demoPackageFree` with ids rewritten). For **all four student × teacher pairs**: a session, two messages, a turn trace, a learner profile, an evidence event, a live subscription and an open teacher question. Every text field carries its owner's marker (for example `[1A]`) so a leak is visible in any returned row.
   - **Case table** `CASES: Record<RepositoryMethod, IsolationCase>`, where `RepositoryMethod` is the template-literal union `` `${repo}.${method}` `` derived from `ReturnType<typeof createRepositories>`. Each case says its scope kind, read or write, how to call the method for an `(actor, target)` pair, and (reads) how to get owner markers from the result.
   - **Property, enumerated exhaustively over the seed** (no new dependency): for every case, every actor scope and every target in the grid:
     - actor owns target → positive control: reads return the owner's rows (non-empty, every row's markers = actor's); writes succeed and the row is readable back by the owner only.
     - actor does not own target (other student same teacher, same student other teacher, both different; other teacher for teacher scope) → reads return `null`/`[]`; writes throw `RepositoryError` `not_found` or `scope`, and a snapshot of every table's `count(*)` and `max(updated_at)` is unchanged.
     - Payload-mismatch writes (`learnerProfiles.save`, `evidenceEvents.append`, `packageVersions.create` with another scope's ids, another teacher's `moduleIds`/`topicId`/`similarIds`) throw `scope` and write nothing.
     - Random well-formed ids (seeded PRNG, 20 per read method) return nothing.
   - **Coverage guard**: the method names enumerated from `createRepositories(db)` equal `Object.keys(CASES)` (fails on a missing or stale case).
   - **Specific checks**: `listForTeacher` results have no `studentId` key; `history` returns oldest-first and respects `limit` (and rejects 0 and 201 with `invalid`); `transcriptStoreFor(scope)` cannot read or append to another pair's session; stored-row corruption (a package_versions row whose config `teacherId` differs from its column, inserted raw) makes `get` throw `integrity`, not return it.
   - Prints one summary line per method (cases, leaks = 0) for the handoff.
5. **`test/migrate.int.test.ts`** (modify): use `test/pg.ts`; its `package_versions` insert of `config: { a: 1 }` no longer typechecks once `config` is `PackageConfig`, so it uses a fixture config.

Then implement: `errors.ts`, `scope.ts` → `map.ts` → repos one by one (each turns its cases green) → `ports.ts` → `index.ts`/`internal.ts`/`package.json` exports → `client.ts` → README.

Coverage: `vitest.config.ts` adds a per-glob threshold for `src/repositories/**` of 100% lines and functions, ≥ 90% branches, enforced when the integration suite runs (see Q3).

Command: `source ~/.nvm/nvm.sh && corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...` with `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`.

## Files

### Create
- `packages/db/src/repositories/errors.ts`, `scope.ts`, `map.ts`, `agent-versions.ts`, `package-versions.ts`, `sessions.ts`, `messages.ts`, `turn-traces.ts`, `learner.ts` (profiles and evidence), `subscriptions.ts`, `teacher-questions.ts`, `ports.ts`, `index.ts`, `README.md`
- `packages/db/src/internal.ts`
- `packages/db/test/pg.ts`, `isolation-seed.ts`, `scope.test.ts`, `types.test.ts`, `repositories.int.test.ts`
- `docs/tasks/1.2/handoff.md` (builder), `docs/tasks/1.2/review.md` (reviewers)

### Modify
- `packages/db/src/schema/agents.ts`, `learning.ts` (`.$type<>()` only; `drizzle-kit generate` must report no changes)
- `packages/db/src/client.ts` (pool options, env parsing, error handler), `src/migrate.ts` (max 1, no statement timeout)
- `packages/db/src/index.ts` (narrowed root export), `package.json` (`exports` adds `./internal`; contracts and zod to dependencies; description), `vitest.config.ts` (per-glob threshold)
- `packages/db/test/client.test.ts`, `migrate.int.test.ts`
- `docker/env.example` (four commented pool variables)
- `pnpm-lock.yaml`

### Out of bounds
- `packages/contracts/**` (no port or schema change; if the builder finds a port cannot be implemented without one, stop and report, since that needs an ADR).
- `packages/db/migrations/**` (no new migration; the `usage_ledger` and `turn_traces` column gaps belong to 2.4 and 3.8/7.7).
- Stores owned by later tasks (table above): no `EntitlementStore`, `ProfileStore`, `TeacherQuestionStore`, `CorrectionStore`, `UsageMeter`, `TraceSink` or `RetrievalIndex` adapter; no `modules.list`, style-card, chunk or document repository.
- `packages/harness/**`, `apps/**`, `packages/payments/**`, `.github/**` (CI already runs Postgres and picks up `test/**/*.test.ts`), `turbo.json`, `.claude/**`, `docs/adr/**`.
- Auth, RBAC and role checks on users (1.3); seed (1.5); audit log (1.6).

### Size
About 450 lines of source and 450 of tests, which is over the 600-line aim (rule 9). See Q1.

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` (every file listed under Create there): group "access filter; money; sign-in, keys, keeping each teacher's and student's data apart" → **`security-reviewer`** (required by the gate). The lead also asked for **`database-reviewer`** and **`typescript-reviewer`**; `review.md`'s `Reviewers:` line names all three.
- All other planned paths (`packages/db/src/schema/**`, `client.ts`, `migrate.ts`, `index.ts`, `internal.ts`, `package.json`, `vitest.config.ts`, `packages/db/test/**`, `docker/env.example`, `pnpm-lock.yaml`, `docs/tasks/1.2/**`): no match. `client.ts`, `index.ts` and `internal.ts` carry isolation weight even though they are outside the glob (the narrowed export is part of "no unscoped path"), so reviewers review them too.
- No migration, so the destructive-SQL check does not apply.
- **Handoff must log a `risk: high` decision**, planned:

> ### 1.2 Isolation enforced by required scopes in the repositories · decided by planner · risk: high
> Decided: Every repository method takes a validated `TeacherScope` or `StudentScope` first and puts it in the WHERE clause of the same statement; messages and turn traces are scoped through a join on `sessions`; another scope's row reads as missing (`null`/`[]`) and writes to it throw `not_found`; frozen ports without a scope parameter (`TranscriptStore`) are bound to a scope at construction; the root `@edmate/db` export has no raw database handle or schema (`@edmate/db/internal` is for migrations, seed and tests). A typed case table makes the isolation test fail to compile when a method has no case.
> Why: Data model rule "repositories require the right scope"; no RLS (1.1 decision); ports are frozen (ADR-0002).
> Alternatives: Postgres RLS; changing the ports to take a scope (ADR); scope checks in the web layer only.
> Reversible: Yes, but every caller binds scopes this way from 1.3 on.

Other decisions to log (risk: low): pool defaults and env names; jsonb columns typed with `.$type<>()` and parsed on read; contracts and zod become runtime dependencies of `@edmate/db`; exhaustive grid instead of a property-testing library (no new dependency); history tie-break by `id` (no sequence column; see Q4); `RepositoryError` kinds and their `ErrorCode`s.

## Open questions (recommendations; none blocks the build)
- **Q1. Size (~900 lines with tests, aim 600).** Recommend one PR: the isolation harness and the methods it covers belong together, and splitting means two risky reviews. Alternative: split the teacher-config methods (`agentVersions`, `packageVersions`) into a follow-up task.
- **Q2. Narrow the root export now (raw handle only via `@edmate/db/internal`)?** Recommend yes: no app imports the package yet, so it costs nothing now, and it makes "no unscoped path" true at the package edge. 1.3 adds an ESLint `no-restricted-imports` for `@edmate/db/internal` in `apps/**` when apps start importing the package.
- **Q3. Coverage without Postgres.** Without a reachable database the integration suite skips locally (1.1 rule), and repository coverage would then fail the package's thresholds and turn `turbo test` red for agents without Docker. Recommend: apply the `src/repositories/**` threshold, and exclude that folder from the package-wide 80%, only when the suite runs (`CI=true` or Postgres reachable, decided in a vitest global setup). CI always enforces it. The builder confirms Vitest's per-glob threshold behaviour with `docs-lookup`.
- **Q4. Message order ties.** `messages` has no sequence column, so two messages with the same `created_at` are ordered by `id` (stable but arbitrary). Recommend accepting this for 1.2 (the pipeline gives the student and agent messages different timestamps) and noting it for 3.8. If the lead wants strict order, that is an additive migration (a `bigserial seq`) and the scope grows.

## READY
Nothing blocks the build. All four open questions have a recommended default, and no spec decision or contracts change is needed.

## Lead answers (18 Oct 2026)

- Q1: keep one PR. Q2: yes, move the raw db handle to an internal subpath now. Q3: enforce repository coverage only when the integration suite runs (CI always runs it). Q4: accept ordering by (created_at, id); log it.
- Before your final push: merge origin/main and regenerate the lockfile if it conflicts; re-run gates.
- Task 3.1 builds in packages/harness in parallel; stay in packages/db.
