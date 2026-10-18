# 1.1 handoff: Drizzle schema for every Data model table; migrations

Status: DONE
Branch: `m1/1.1-drizzle-schema`
Worktree: `.claude/worktrees/agent-a8356adbed5bd3b86`
Risky: yes, `.github/**` (CI Postgres service). Reviewer: `security-reviewer`. No file under
`packages/db/src/repositories/**`; migrations are create-only (no `database-reviewer` trigger).

## Acceptance evidence

Accept: "migrate up/down clean; teacher-owned tables indexed on `teacher_id`."

Postgres: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`
(the pinned `pgvector/pgvector:0.8.1-pg16`, published on 127.0.0.1:55432 by the test-only override), stopped after.

Migrate up / down / re-apply (`test/migrate.int.test.ts`, a throwaway database `edmate_test_<hex>` per run,
dropped afterwards). `corepack pnpm exec vitest run --coverage --reporter=verbose`, trimmed:
```
[migrate up] 36 tables, 313 columns, 117 indexes, pgvector=true, migrations applied=2
  ✓ apply cleanly to an empty database
  ✓ re-running is a no-op
  ✓ store and read rows: vector embedding, generated tsvector, scoped keys
[migrate down] dropped schemas public and drizzle; 0 tables left
[migrate re-apply] 36 tables, 117 indexes
  ✓ tear down (drop the test schemas) and apply again from scratch
```
Each step checks every table, column and index in the newest drizzle-kit snapshot against
`information_schema` / `pg_indexes`, plus the `vector` extension. The re-apply runs through the CLI
(`runMigrateCli`). The built CLI was also run twice on a scratch database:
`DATABASE_URL=… corepack pnpm --filter @edmate/db db:migrate` → `db:migrate: migrations applied` (both runs), 36 tables.

Teacher-owned tables indexed on `teacher_id` (`test/schema.test.ts`, by reflection over the migration
snapshot: every table with a `teacher_id` column has an index whose leading column is `teacher_id`):
```
teacher_id indexes (24 tables):
  agent_versions: agent_versions_teacher_id_idx
  agents: agents_teacher_id_idx
  chunks: chunks_teacher_id_module_id_idx
  corrections: corrections_teacher_id_idx
  courses: courses_teacher_id_idx
  documents: documents_teacher_id_idx
  eval_runs: eval_runs_teacher_id_idx
  evidence_events: evidence_events_teacher_id_student_id_idx
  insights: insights_teacher_id_week_key
  invoices: invoices_teacher_id_idx
  learner_profiles: learner_profiles_teacher_id_student_id_key
  ledger_entries: ledger_entries_teacher_id_idx
  live_classes: live_classes_teacher_id_starts_at_idx
  modules: modules_teacher_id_idx
  package_versions: package_versions_teacher_id_idx
  packages: packages_teacher_id_idx
  payments: payments_teacher_id_idx
  payouts: payouts_teacher_id_idx
  sessions: sessions_teacher_id_student_id_idx
  style_cards: style_cards_teacher_id_version_key
  subscriptions: subscriptions_teacher_id_student_id_idx
  teacher_questions: teacher_questions_teacher_id_status_idx
  topics: topics_teacher_id_idx
  usage_ledger: usage_ledger_teacher_id_package_id_student_id_idx
```

Package gates: `corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...`
```
@edmate/db:test:       Tests  35 passed (35)
@edmate/db:test: All files       |     100 |     90.9 |     100 |     100 |
 Tasks:    11 successful, 11 total
```
Skip and CI paths: `TEST_DATABASE_URL=<unreachable> CI= …vitest run` → `2 passed | 1 skipped`, with
`[@edmate/db] migration integration tests SKIPPED: no Postgres at TEST_DATABASE_URL … Start one with: docker compose …`;
with `CI=true` (through turbo) → `Error: CI=true but no Postgres is reachable at TEST_DATABASE_URL`, task fails.

Schema and migrations in sync: `drizzle-kit generate` → `No schema changes, nothing to migrate`; `drizzle-kit check` → `Everything's fine`.

Root gates: `corepack pnpm install --frozen-lockfile && corepack pnpm turbo run build typecheck lint test`
```
 Tasks:    39 successful, 39 total
```
Harness tests: `python3 -m unittest discover .claude/tests` → `Ran 122 tests … OK`.
Secret scan: `python3 .githooks/secret-scan.py --all` → exit 0, no output (also run on the staged files before commit).

TDD: the three test files were written first and ran red (missing modules), then the schema, client,
migrator and CLI were written and the migrations generated.

## Changes

- `packages/db/src/schema/` — 36 tables, one per name in the Data model, in domain files: `users.ts`
  (users, teacher_profiles, consents), `content.ts` (courses, modules, topics, documents, chunks, style_cards,
  corrections), `agents.ts` (agents, agent_versions, packages, package_versions), `billing.ts` (subscriptions,
  payments, payouts, ledger_entries, invoices, webhook_events), `learning.ts` (sessions, messages, turn_traces,
  usage_ledger, evidence_events, learner_profiles, teacher_questions), `operations.ts` (eval_runs, eval_results,
  live_classes, class_questions, insights, reports, takedowns, safety_events, audit_log). `_shared.ts` holds the
  id/timestamp helpers, 9 Postgres enums, and the pgvector `vector` / `tsvector` custom types.
  Every table: `text` id (UUID default), `created_at`/`updated_at` timestamptz. Every `teacher_id`/`student_id`
  references `users.id`; every foreign key column is indexed.
  Constraints from the spec: partial unique (student_id, teacher_id) on subscriptions where status <> 'ended';
  unique learner_profiles (teacher_id, student_id); unique webhook_events.provider_event_id; unique
  (agent_id, version), (package_id, version), (teacher_id, version) on style_cards; unique provider refs.
  Money: `amount_minor bigint` with `>= 0` (`> 0` on ledger entries) and `currency ~ '^[A-Z]{3}$'` checks.
  chunks: nullable dimensionless `embedding vector`, `search tsvector GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED` with a GIN index.
- `packages/db/migrations/` — `0000_enable_pgvector.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, custom) and
  `0001_data_model.sql` (generated: CREATE TYPE / TABLE / INDEX, ADD CONSTRAINT … FOREIGN KEY only), plus drizzle-kit `meta/`.
- `packages/db/src/client.ts` (`createDb(env)` → `{ db, pool, close }`, throws if `DATABASE_URL` is missing),
  `src/migrate.ts` (`migrateDatabase(url)`, `MIGRATIONS_DIR`), `src/cli.ts` (`runMigrateCli`, redacts connection
  strings from errors), `src/bin/migrate.ts` (entry), `src/index.ts` re-exports these and the schema.
- `packages/db/package.json` — scripts `build` (tsconfig.build.json), `test`, `db:generate`, `db:migrate`; deps below.
  `drizzle.config.ts`, `tsconfig.json` (typecheck src+test), `tsconfig.build.json`, `vitest.config.ts` (80% thresholds; `src/bin/**` excluded).
- `packages/db/test/` — `schema.test.ts` (table set, ids/timestamps, FK targets, snapshot ↔ schema drift, teacher_id
  and student_id indexes, spec constraints, enum ↔ contracts drift, create-only migrations using merge_gate's
  `DESTRUCTIVE_SQL`), `client.test.ts`, `migrate.int.test.ts`, `helpers.ts`, `compose.port.yaml` (test-only Compose override).
- `.github/workflows/ci.yml` — `node` job gets a `services.postgres` container (same image, pinned by digest, health-checked)
  and `TEST_DATABASE_URL`.
- `turbo.json` — `test` declares `env: ["TEST_DATABASE_URL"]` and `passThroughEnv: ["CI"]` (Turbo's strict env mode
  otherwise strips both, and CI would silently skip the integration tests).
- `pnpm-workspace.yaml` — `allowBuilds: esbuild: false` (drizzle-kit pulls esbuild; pnpm refused to add it otherwise).
- `pnpm-lock.yaml`.

Exact pins: `drizzle-orm 0.45.4`, `pg 8.23.1` (dependencies); `drizzle-kit 0.31.11`, `@types/pg 8.23.1`,
`@types/node 22.20.5`, `vitest 5.0.5`, `@vitest/coverage-v8 5.0.5`, `zod 4.6.7`, `@edmate/contracts workspace:*` (dev, for drift tests).
CI image: `pgvector/pgvector:0.8.1-pg16@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337`.

## Deviations

- Files: schema is grouped into 6 domain files (+ `_shared.ts`), not one file per Data-model row. Same tables, fewer files.
- Out-of-scope files touched (all needed to make the acceptance run in CI): `turbo.json` (env pass-through),
  `pnpm-workspace.yaml` (esbuild build script off), `pnpm-lock.yaml`.
- Local Postgres: `docker/compose.yaml` publishes no Postgres port, so tests reach it through a test-only override
  `packages/db/test/compose.port.yaml` (127.0.0.1:55432). `docker/compose.yaml` is unchanged.
- The up/down test uses a throwaway database per run (then drops it) and, inside it, does the plan's
  `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`, plus `DROP SCHEMA drizzle CASCADE` (drizzle's migrations table lives there).
- CI service port is `5432:5432`, not `127.0.0.1:5432:5432`: GitHub's service `ports` syntax is documented as
  `host:container`, and I could not verify an IP prefix there without a CI run. Hosted runners accept no inbound
  connections, so the database is reachable only from the job.
- Columns the spec doesn't list, added where the contracts or the table's job need them: `chunks.source_title`/`locator`
  (SourceRef), `teacher_questions.similar_ids` (TeacherQuestion), `agents.live_version`, `packages.agent_id`/`name`/`live_version`,
  `sessions.agent_id`/`ended_at`, `messages.sources`, ledger `transaction_id`/`account`/`direction`, `eval_runs.teacher_id`,
  `eval_results.case_id`/`passed`/`details`, `live_classes.title`, `class_questions.live_class_id`/`text`/`order`,
  `reports.reporter_id`, `payments/invoices.student_id`, payout period, `invoices.number`, `status` on payments/payouts.

## Decisions

### 18 Oct 2026 · 1.1 CI Postgres service container on the node job · decided by tdd-guide · risk: high
Decided: `.github/workflows/ci.yml`'s `node` job runs a `postgres` service (pgvector/pgvector:0.8.1-pg16, pinned by digest,
health-checked) with a throwaway password, and sets `TEST_DATABASE_URL`. `turbo.json` passes `TEST_DATABASE_URL` and `CI` to
`test`. The db integration tests fail when `CI=true` and the database is unreachable, and skip with a message locally.
Why: The acceptance ("migrate up/down clean") needs a real Postgres + pgvector on every PR (lead answer). Touches `.github/**`, so security-reviewer.
Alternatives: pglite (different engine, partial pgvector); a separate job (duplicates install/build); keep it local-only (no CI proof).
Reversible: Yes. Remove the service block and the env lines.

### 18 Oct 2026 · 1.1 Text ids with a UUID default · decided by planner · risk: low
Decided: Every primary and foreign key is `text`; new rows get `crypto.randomUUID()`.
Why: The contracts' id is any `[A-Za-z0-9_-]{1,128}` (fixtures use `stu_test_01`); a `uuid` column would reject valid ids.
Alternatives: Postgres `uuid`; prefixed ids.
Reversible: Yes, with a type-changing migration.

### 18 Oct 2026 · 1.1 "Migrate up/down clean" = apply, drop the test schemas, re-apply · decided by planner (lead accepted) · risk: low
Decided: Migrations are forward-only (drizzle-kit, no down files). The test applies them to an empty throwaway database, drops
`public` and `drizzle`, and applies them again; re-running on an applied database is a no-op.
Why: `database-migrations` skill: forward-only migrations; drizzle-kit has no per-file rollback.
Alternatives: Hand-written down.sql per migration.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Embedding column has no dimension and no vector index yet · decided by planner (lead accepted) · risk: low
Decided: `chunks.embedding` is a nullable dimensionless `vector` (a custom type). The dimension and the HNSW index come with
the embedding model in 2.7/5.3, in an additive migration. `0000_enable_pgvector.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`
so CI and managed hosts work without docker/postgres/init.sql.
Why: The embedding model isn't chosen; guessing a dimension would mean a re-index later.
Alternatives: Fix 1536 now.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Isolation in repositories, not RLS · decided by planner (lead accepted) · risk: low
Decided: No Postgres RLS policies. Teacher and student scoping is enforced by task 1.2's repositories; the schema gives every
teacher-owned table a `teacher_id` (FK to users, leading an index) and every student table a `student_id` (leading an index).
Why: ADR-0002's port split; one app database user.
Alternatives: RLS policies per table.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Postgres enums for the fixed sets, checked against the contracts · decided by tdd-guide · risk: low
Decided: 9 `pgEnum`s: user_role, subscription_status, agent_status, chunk_kind, message_role, teacher_question_status,
evidence_source, model_tier, ledger_direction. Tests fail if a set drifts from the contracts' Zod enum. Open-ended values
(verification_status, payment/payout status, report/takedown/safety status, consent kind) are plain `text`.
Why: The database rejects values the app can't produce; adding a value later is an additive `ALTER TYPE … ADD VALUE`.
Alternatives: text + CHECK (changing it needs DROP CONSTRAINT, which the merge gate flags as destructive); text with no constraint.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Full-text search uses the 'simple' configuration · decided by tdd-guide · risk: low
Decided: `chunks.search` is `to_tsvector('simple', text)`, generated and stored, with a GIN index.
Why: Edmate is country-neutral; 'simple' doesn't stem for one language, so it behaves the same for every locale. Per-locale configs can come with 2.7.
Alternatives: 'english'; a per-row regconfig column.
Reversible: Yes (additive migration with a new column/index).

### 18 Oct 2026 · 1.1 Money and cost as bigint read as JS numbers · decided by tdd-guide · risk: low
Decided: `amount_minor` and `cost_micro_usd` are `bigint` columns mapped to `number` (`mode: 'number'`), matching the contracts' `count()`;
ledger entries are positive amounts with a debit/credit direction grouped by `transaction_id`.
Why: Values stay far below 2^53; the contracts use numbers.
Alternatives: `mode: 'bigint'`; numeric.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Dependency pins and esbuild build script · decided by tdd-guide · risk: low
Decided: drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @types/pg 8.23.1 (npm `latest` on 18 Oct 2026; drizzle 1.0 is still rc).
`pnpm-workspace.yaml` sets `allowBuilds: esbuild: false`: drizzle-kit's esbuild uses its prebuilt optional platform package.
Why: Exact pins (rule); pnpm refuses unlisted install scripts.
Alternatives: drizzle 1.0.0-rc; allow esbuild's install script.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Review · decided by team lead · risk: low
Decided: Money and cost columns in packages/db/src/schema/billing.ts stay `bigint` in number mode, which is exact up to 2^53 (about 9 quadrillion minor units); contracts use JS numbers too. Typed jsonb columns, session joins for message isolation, and pool limits are follow-ups in task 1.2.
Why: The ceiling is far above any realistic amount, and 1.2 is where rows are mapped to contract shapes.
Alternatives: bigint as strings or BigInt everywhere.
Reversible: Yes, one migration.
