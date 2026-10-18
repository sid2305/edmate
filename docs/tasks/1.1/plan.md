# 1.1 plan — Drizzle schema for every table in Data model; migrations

Board: `board.py show 1.1` · Milestone M1 · deps: M0 (done) · branch `m1/1.1-drizzle-schema` · model `plan:sonnet`.

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Drizzle schema for every table in Data model; migrations."
Accept: "migrate up/down clean; teacher-owned tables indexed on `teacher_id`."

### How each part is shown (paste in handoff.md)
| Part | Evidence |
|---|---|
| Migrate up/down clean | Integration test spins up a throwaway schema on the pinned Postgres (below), runs `drizzle-kit migrate` from empty, asserts every table/column/index from this plan exists via `information_schema`, then drops the schema (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` — test-DB only, not a migration file) and re-runs `migrate` to prove it is clean and repeatable from scratch. Paste the test output. (Drizzle-kit is forward-only — no per-file `down.sql` — matching `database-migrations` skill principle 2; "down" here means "tear down and reapply cleanly," logged as a decision below.) |
| Teacher-owned tables indexed on `teacher_id` | A schema test asserts, by reflection over the generated SQL/snapshot, that every table carrying `teacher_id` has a non-unique btree index on it (or it's the leading column of a composite index). List pasted in the handoff. |

## Design

### Scope: schema + migrations only
`packages/db/src/schema/*.ts` (one file per Data-model row, re-exported from `src/schema/index.ts`), `packages/db/migrations/` (drizzle-kit output), `drizzle.config.ts`, a minimal `packages/db/src/client.ts` (a `Pool`/`drizzle()` factory reading `DATABASE_URL`; no query helpers beyond that). `src/index.ts` re-exports schema + the client factory only.

**Out of bounds** (later tasks own these; do not add them here):
- `packages/db/src/repositories/**` — scoping, fail-closed cross-teacher/cross-student checks: **task 1.2**, and that path is in `risk-paths.txt` (`security-reviewer`). 1.1 adds no file under `repositories/`.
- Auth.js/RBAC (1.3), magic link (1.4), seed script (1.5), audit-log helper (1.6, though `audit_log`'s table shape is created here), consent flow (1.7), demo content (1.8).
- No query/business logic, no API routes, no RLS policies (not decided; Postgres roles are single-app-user here, isolation is enforced in 1.2's repositories per ADR-0002's port split, not DB-level RLS — flag as a decision, not a blocker).

### One table per Data-model row, snake_case, `text` ids (not Postgres `uuid`)
Contracts' `id()` is `/^[A-Za-z0-9_-]+$/`, 1–128 chars — not necessarily UUID-shaped (fixtures use ids like `stu_test_01`). So every primary/foreign key is `text`, not the `uuid` type, so the DB never rejects an id the app considers valid. New rows default to `crypto.randomUUID()` via `$defaultFn` (satisfies the id regex); nothing stops a future prefixed-id scheme. **Decision to log** (risk: low).

Group (spec row → tables, key columns, indexes). Every teacher-owned row carries `teacher_id` (indexed); every student row carries `student_id` (indexed, usually composite with `teacher_id`).

| Data-model row | Tables | Columns (beyond id/timestamps) | Indexes / constraints |
|---|---|---|---|
| `users` | `users` | email?, phone?, name, locale, market, role, age_confirmed_at | unique partial index on `email` where not null; same for `phone`; index `role` |
| `teacher_profiles` | `teacher_profiles` | user_id (fk→users), slug, subject, bio, photo, languages, verification_status, payout_account_ref | unique `user_id`; unique `slug` |
| `consents` | `consents` | user_id, kind, version, ts | index `user_id`; unique (`user_id`,`kind`,`version`) |
| `courses`/`modules`/`topics` | `courses`, `modules`, `topics` | teacher_id, course_id/module_id fk, title, order, outline_version | index `teacher_id` on each; index `course_id`/`module_id` fk |
| `documents`/`chunks` | `documents`, `chunks` | documents: teacher_id, module_id, kind, source title/locator, storage_key, rights_declared_at. chunks: teacher_id, document_id fk, module_id, kind, text, source title/locator, `embedding` (pgvector, see Open questions), `tsvector` generated column | index `teacher_id`, `module_id`, `document_id`; GIN on `tsvector`; vector index deferred (below) |
| `style_cards` | `style_cards` | teacher_id, version, text, mistake_tags | index `teacher_id`; unique (`teacher_id`,`version`) |
| `agents`/`agent_versions` | `agents`, `agent_versions` | teacher_id, config JSONB, status; versions immutable | index `teacher_id`; unique (`agent_id`,`version`) |
| `packages`/`package_versions` | `packages`, `package_versions` | teacher_id, config JSONB | index `teacher_id`; unique (`package_id`,`version`) |
| `subscriptions` | `subscriptions` | student_id, teacher_id, package_version_id, status, period_end, provider_ref | index (`student_id`,`teacher_id`), `teacher_id`; **partial unique** on (`student_id`,`teacher_id`) where `status` not in (`ended`) — "one active per student × teacher" |
| `payments`/`ledger_entries`/`payouts`/`invoices` | 4 tables | amount_minor, currency, provider refs, market, teacher_id where applicable | index `teacher_id`; unique provider ref per table |
| `webhook_events` | `webhook_events` | provider_event_id, payload_hash, processed_at | unique `provider_event_id` |
| `sessions`/`messages` | `sessions`, `messages` | student_id, teacher_id, agent_version, help_state, summary; messages: session_id fk, role, text, created_at | index (`student_id`,`teacher_id`); index `session_id`, `created_at` |
| `turn_traces` | `turn_traces` | session_id, steps JSONB, model, tokens, cost_micro_usd | index `session_id` |
| `usage_ledger` | `usage_ledger` | teacher_id, package_id, student_id, model, tier, tokens, cost_micro_usd | index (`teacher_id`,`package_id`,`student_id`) |
| `evidence_events`/`learner_profiles` | 2 tables | student_id, teacher_id, topic_id/mastery JSONB | index (`student_id`,`teacher_id`); unique on `learner_profiles` (`student_id`,`teacher_id`) — "one per pair" |
| `corrections` | `corrections` | teacher_id, question, bad_answer, corrected_answer, module_id | index `teacher_id`, `module_id` |
| `teacher_questions` | `teacher_questions` | teacher_id, agent_id, student_id, text, module_hint, group_id, status, answer, answered_at | index `teacher_id`, `status`; `student_id` stored but hiding it from teacher-facing reads is an **API/repository** concern (1.2+), not schema |
| `eval_runs`/`eval_results` | 2 tables | agent_version, suite, model, pass_rate | index (`agent_version`,`suite`) |
| `live_classes`/`class_questions` | 2 tables | teacher_id, package ids, starts_at, link; questions | index `teacher_id` |
| `insights` | `insights` | teacher_id, week, payload JSONB | unique (`teacher_id`,`week`) |
| `reports`/`takedowns`/`safety_events` | 3 tables | target, reason, status, staff actions | index `target`, `status` |
| `audit_log` | `audit_log` | actor, action, target, before/after JSONB, ts | index (`target`,`ts`), (`actor`,`ts`) |

Every table also gets `created_at`/`updated_at` timestamptz defaults (`now()`), per `postgres-patterns`. JSONB columns (`config`, `steps`, `payload`, `before`/`after`) are stored as `jsonb`, validated by the contracts' Zod schemas at the port boundary (1.2+), not re-validated in SQL.

### Tooling and scripts
- `drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './src/schema/index.ts'`, `out: './migrations'`, `dbCredentials.url: process.env.DATABASE_URL`.
- `packages/db/package.json` scripts: `db:generate` (`drizzle-kit generate`), `db:migrate` (small `scripts/migrate.ts` using `drizzle-orm/node-postgres/migrator`'s `migrate()` against a `pg.Pool`), wired into root as `pnpm --filter @edmate/db db:migrate` (worker/web call this on boot — a later task).
- First migration is `CREATE TABLE`/`CREATE INDEX` only — no `DROP`/`ALTER … DROP`/`TRUNCATE`/`DELETE`/bare `UPDATE … SET`, so `merge_gate.py`'s `DESTRUCTIVE_SQL` check stays clean and this PR needs no `database-reviewer` sign-off under rule 6's migration clause.

### Dependency pins (new, exact versions — no caret)
`drizzle-orm`, `drizzle-kit`, `pg` (node-postgres driver — plain TCP pool, matches Compose's non-serverless Postgres; `postgres`/`pg` both fit, `pg` chosen for the widest Drizzle example coverage) plus `@types/pg`. **The builder confirms exact current versions with `docs-lookup`/`search-first` before pinning** (same as 0.3 did for zod) and logs the chosen versions as a decision.

## Testing strategy — real Postgres, not pglite
Recommend a **real Postgres 16 + pgvector** for `packages/db`'s integration tests, not `pglite`:
- pgvector's extension and its index types (HNSW) are native-Postgres behaviour; pglite's WASM build has partial/uncertain pgvector parity and would test a different engine than prod.
- The project already pins `pgvector/pgvector:0.8.1-pg16` (0.2); reusing that image keeps dev/CI/prod on the same engine (Tech stack's "boring dependencies" principle).
- Local dev: tests target `docker/compose.yaml`'s existing `postgres` service (already on `127.0.0.1` only).
- CI: add a Postgres `services:` block to the `node` job in `.github/workflows/ci.yml` using the same pinned image (GitHub Actions service containers are reachable only from the job's own runner — satisfies "no network beyond localhost"); `packages/db`'s `test` script points `DATABASE_URL` at it. This CI change is inside `.github/**`, which **is** a risk-paths.txt group (`security-reviewer`) — call this out explicitly in review.md if the CI edit lands in this PR.
- Unit tests for schema shape (column/index assertions) run against the drizzle-kit snapshot JSON, no live DB needed; only the up/down proof needs the real instance.

## Open questions (flag in handoff; none block starting)
1. **pgvector embedding dimension.** `ports.ts` says embeddings are "platform-wide config… decided elsewhere," and the model/dimension isn't chosen until 2.7/5.3. Recommendation: declare `chunks.embedding` as an **unconstrained, nullable** `vector` column now (via `customType`, confirming the exact drizzle-orm API for pgvector with `docs-lookup` since support varies by version) with no HNSW index yet; 2.7/5.3 adds the dimension constraint and the HNSW index in a new, additive (non-destructive) migration once the model is picked. Avoids guessing a number now and a wasted re-index later.
2. **"Up/down clean" reading.** Taken as "apply to empty, tear down the test schema, reapply cleanly" rather than per-file rollback SQL, per `database-migrations`' forward-only principle. Logging as a risk: low decision rather than asking, but flagging here in case the human reads it differently.
3. **Isolation mechanism.** Teacher/student scoping is enforced in 1.2's repositories (ports), not Postgres RLS — consistent with ADR-0002 (ports in `contracts`, adapters in `db`). No RLS policies added in 1.1.

## Risky paths (checked against `risk-paths.txt`)
- `packages/db/src/repositories/**` (security-reviewer group) — **not touched**; 1.1 adds no file there.
- `packages/contracts/**`, `docs/adr/**` — not touched.
- `packages/harness/src/guardrails/**`, `access/**`, `payments/**`, webhooks, auth, keys, `.claude/**`, `.githooks/**` — not touched.
- `.github/**` (security-reviewer) — touched **only if** this PR also adds the CI Postgres service; otherwise defer that edit to a follow-up and this group is clean.
- Destructive-migration check (not a path, `merge_gate.py` content scan): clean — first migration is additive only.
- **Net:** no risk-paths.txt group is hit by the schema/migration files themselves; this is **not** a `risk: high` PR unless the CI `.github/**` edit is included, in which case `review.md` must name `security-reviewer` and the handoff logs `risk: high`. Recommend keeping the CI service-container edit in this same PR (it's needed to prove the acceptance criterion) and treating the PR as risky for that reason alone.

## READY / BLOCKED
**READY.** No open decision blocks starting; the three open questions above have working recommendations and are logged, not asked.

## Lead answers (18 Oct 2026)

- Open questions 1–3: accepted as recommended (unconstrained nullable embedding column for now; "up/down clean" = apply to empty, drop the test schema, re-apply; isolation in 1.2 repositories, not RLS).
- Tests: real Postgres 16 + pgvector (`pgvector/pgvector:0.8.1-pg16`), locally via docker/compose.yaml's postgres service, in CI via a `services:` block on the `node` job (localhost only). Integration tests must skip with a clear message when no database is reachable locally, but must run in CI (fail if `CI=true` and no DB).
- The CI change is in this PR, so `.github/**` is touched: review.md names `security-reviewer`; the handoff needs a `risk: high` entry. Build only after task 0.9 has merged (it also edits ci.yml); start the branch from that main.
- Pins: look them up with `docs-lookup` only if unsure; log exact versions in the handoff.
