# Task 1.5: Seed — the demo teacher (from 1.8), its two packages, 20 students with mixed subscriptions

Board: `python3 .claude/skills/board/board.py show 1.5` · Milestone M1 · deps: 1.1, 1.8, M0 · branch
`m1/1.5-seed`.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Seed: the demo teacher (from 1.8), its two packages, 20 students with mixed subscriptions"
Accept: "`corepack pnpm seed` idempotent."

(Build plan § M1, line 548, is the same sentence; no extra detail there.)

## How it will be shown

`source ~/.nvm/nvm.sh && corepack pnpm seed` against the compose Postgres (started with
`docker compose -f docker/compose.yaml up -d postgres`, or the test override that publishes it on
`127.0.0.1:55432`), run twice in a row: second run logs "already seeded" / unchanged counts, no
duplicate rows, same ids. `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
green, including a new Postgres-integration test that runs the seed function twice and asserts row
counts and ids are identical.

## Design

**Where the code lives:** `packages/db` (not a new package) — it already owns `internal.ts`,
explicitly scoped for "migrations, the seed (1.5) and tests", and the `bin/`-entry-point +
`cli.ts`-function pattern `db:migrate`/`db:grant-role` already use. `packages/content`'s loader
comment also names 1.5 as the one that assigns the ids and versions its drafts leave out — so the
seed, not a new package, is the natural owner.

**Reads content, not the identity store or repositories.** The seed:
1. Calls `loadDemoTeacherContent(contentDir)` from `@edmate/content` (new workspace dependency of
   `@edmate/db`) on `content/demo-teacher/` (path resolved relative to the repo root, overridable
   by an env var for tests pointing at a fixture dir).
2. Builds the frozen contracts objects the drafts are missing fields for — `AgentConfig`,
   `PackageConfig` (free, paid), `StyleCard` — with fixed ids the seed owns (e.g. `demo-teacher`,
   `demo-agent`, `demo-course`, `demo-style-card-v1`, `demo-package-free`, `demo-package-paid`,
   module ids taken as-is from `course.yaml`'s `modules[].id`, e.g. `values-variables`). These must
   be validated with `AgentConfigSchema`/`PackageConfigSchema`/`StyleCardSchema` before insert (the
   contracts are frozen; the seed is just another port-boundary caller).
3. Writes through `createDb`/the raw schema from `@edmate/db/internal` directly (not through
   `packages/db/src/repositories/**`) in one transaction per logical unit, using fixed, stable ids
   and `onConflictDoNothing` (targeted at each table's primary key) so re-running inserts nothing
   new. This is why the plan needs **no new repository method**: every existing repository method
   is scoped and some (`packageVersions.create`) deliberately re-derives ids and rejects an existing
   (package, version) with `invalid` rather than silently no-op'ing, which would make the seed noisy
   on every re-run. `internal.ts` bypassing the repositories is the documented, intended path for
   this task.
4. Why module ids matter: `modules.id` is the primary key repositories join against when a package
   names `moduleIds` (`packageVersions.create`'s "every module it unlocks must be one of that
   teacher's modules"), and `PackageConfig.moduleIds` in `content/demo-teacher/packages/*.yaml` are
   literally `values-variables`, `conditions`, etc. So the seed must insert `modules` rows with
   `id` set explicitly to those content ids (not the column's random-UUID default), one per
   `course.yaml` module, in file order. Likewise `courses.id` is set to `course.yaml`'s own `id`
   (`python-basics-demo`) so `AgentConfig.courseId` can name it directly.
5. Order of inserts (each step `onConflictDoNothing` on id): teacher `users` row + `teacher_profiles`
   row → `courses` row → `modules` rows → `style_cards` row → `agents` row (status `draft` first,
   then updated to `status: 'live', liveVersion: 1` once its version exists — matching how a real
   publish works) → `agent_versions` row (version 1) → `packages` rows (free, paid; `liveVersion`
   left null until their version exists, then set to 1) → `package_versions` rows (version 1 each)
   → 20 student `users` rows → 20 `subscriptions` rows, one per student, each pointing at a
   `package_versions` row.
6. **20 students, mixed subscriptions.** Every subscription needs a real row: the subscription path
   of `entitlementStoreFor.resolve` (`packages/db/src/repositories/ports.ts`) calls
   `subscriptions.findLive`, so even the "free" bucket needs an `active`-status row pointing at the
   free package version, not just an implicit default. Plan: 5 free-active (free package version,
   `status: 'active'`), 5 paid-active (paid package version, `status: 'active'`), 5 paused (paid
   package version, `status: 'paused'`, to exercise the "paid students keep access... until a staff
   decision" vs. the cost-alarm's free-only pause — a paused paid row is a distinct, teacher/staff
   kind of pause, already representable by the enum), 5 ended (`status: 'ended'`, either package).
   Fixed student ids (`demo-student-01` … `demo-student-20`) and fixed subscription ids so
   `onConflictDoNothing` on each table's id makes the whole batch idempotent per row, independent of
   the others.
7. **Students: no real names/emails, ages ≥ 13, some 13–17, market `global`.** `users.email` like
   `demo-student-01@example.invalid` (RFC 2606 reserved, non-resolvable domain — the task's own
   suggestion), `name` a generic synthetic label (e.g. "Demo Student 01"), `role: 'student'`,
   `locale: 'en'`, `market: 'global'` (matches the only market the identity store's `createStudent`
   ever sets today — 1.3 decision, Q2 — even though this task bypasses that store). `ageConfirmedAt`
   set to a fixed seed timestamp for every student (an attestation flag the schema already has from
   migration 0001); see Open question 1 below on why no numeric age or `consents` row is stored.
8. **Idempotency mechanics.** Every insert uses a fixed id and `onConflictDoNothing({ target:
   table.id })`; nothing is ever `UPDATE`d or deleted by the seed, so it can never violate
   `DESTRUCTIVE_SQL` scanning used elsewhere and never collide with a teacher's own later edits to
   the same rows (a real teacher would get a different, random id). A top-level log line reports
   how many rows each step actually inserted (0 on the second run) so `corepack pnpm seed` run twice
   is visibly a no-op, matching `db:migrate`'s "migrations applied" / re-run pattern.
9. Sessions, documents, chunks and embeddings are out of scope (ingestion is M5/M6; "chunks/
   embeddings... unless trivial" — nothing here is trivial enough to justify a `documents`/`chunks`
   row with no real ingestion pipeline behind it, so none are seeded).

## Files to create

- `packages/db/src/seed.ts` — the seed's logic as a plain exported async function
  `seedDemoTeacher(db, options)` (content dir override for tests), returning counts per table
  inserted, following the `cli.ts`-function pattern so it is unit-testable without a process exit.
- `packages/db/src/bin/seed.ts` — thin entry point (`#!/usr/bin/env node`), same shape as
  `bin/migrate.ts`.
- `packages/db/test/seed.int.test.ts` — Postgres-integration test (same `postgresUp`/throwaway-db
  pattern as `migrate.int.test.ts`): migrate a throwaway db, run the seed, assert row counts and
  specific ids/relationships (teacher → agent `live`,version 1 → both packages live,version 1 →
  20 students with the 5/5/5/5 status split → each subscription's package version belongs to the
  demo teacher); run the seed a second time, assert identical counts and ids (no duplicates).
- `docs/tasks/1.5/handoff.md` (builder), `docs/tasks/1.5/review.md` (reviewers).

## Files to modify

- `packages/db/package.json` — add `@edmate/content: workspace:*` dependency; add script
  `"db:seed": "node dist/bin/seed.js"`.
- `packages/db/src/cli.ts` (optional refactor target) — if the builder prefers a `runSeedCli`
  function here for symmetry with `runMigrateCli`/`runGrantRoleCli`, rather than putting the CLI
  surface directly in `seed.ts`; either is fine, pick one and keep `seed.ts` as the testable core.
- Root `package.json` — add a `"seed"` script so `corepack pnpm seed` works from the repo root,
  e.g. `"seed": "pnpm --filter @edmate/db build && pnpm --filter @edmate/db run db:seed"` (matches
  the existing "build, then run the compiled CLI" pattern `db:migrate`/`db:grant-role` already
  need; `corepack pnpm --filter @edmate/db db:migrate` is documented the same way in
  `docker/env.example`).
- `docker/env.example` — one line noting `corepack pnpm seed` needs `DATABASE_URL` set (same as
  `db:migrate`), for whichever Postgres the caller points it at.

## Files out of bounds

- `packages/db/src/repositories/**`, `packages/db/src/identity/**` — no new methods; the plan above
  uses `internal.ts` precisely to avoid touching either. If review decides a repository method is
  needed after all (for example, to reuse `packageVersions.create`'s module-ownership check instead
  of re-deriving it in the seed), that file becomes risky (see below) and needs security-reviewer;
  flagged, not pre-decided.
- `packages/contracts/**` — no contracts change; the seed only constructs values already shaped by
  the frozen `AgentConfigSchema`/`PackageConfigSchema`/`StyleCardSchema`.
- `content/demo-teacher/**` — read-only; 1.8 owns it and is already `done`.
- `packages/db/migrations/**` — no schema change; every column the seed needs (`ageConfirmedAt`,
  `subscriptions.status`, etc.) already exists from migrations 0001–0005.
- Documents/chunks/embeddings, live classes, teacher questions, eval runs — not this task.

## Tests first (Vitest, TDD)

1. Unit (`seed.test.ts`, no real Postgres): given a fake/in-memory db double or a fixture content
   dir (reuse `packages/content/test/fixtures/valid/` shape, or 1.8's real
   `content/demo-teacher/`), `seedDemoTeacher` builds `AgentConfig`/`PackageConfig`/`StyleCard`
   objects that pass their contracts schemas; module ids in each package draft are a subset of the
   course's module ids; the student/subscription split is exactly 5/5/5/5.
2. `seed.int.test.ts` (Postgres, same skip/CI-fail pattern as `migrate.int.test.ts`): migrate a
   throwaway db → run the seed → assert: one teacher user, one teacher_profile, one course, five
   modules (ids match `course.yaml`), one style card, one agent (`status: 'live'`, `liveVersion:
   1`), one agent_version (version 1, config passes `AgentConfigSchema`), two packages both
   `liveVersion: 1`, two package_versions (versions passing `PackageConfigSchema`, `moduleIds` a
   subset of the five seeded modules), 20 student users (emails end `@example.invalid`, role
   `student`, market `global`), 20 subscriptions split 5 free-active / 5 paid-active / 5 paused / 5
   ended, each `subscriptions.package_version_id` resolving (via a join) to the demo teacher's own
   package version (no cross-teacher leak — there is only one teacher here, but the assertion
   future-proofs a later multi-teacher seed).
3. Same test, run the seed function a second time on the same database: assert every count is
   unchanged and every id returned is identical to the first run (idempotency, the task's actual
   accept bar).
4. A third assertion: `entitlementStoreFor(...).resolve({ studentId: <a free-active student>,
   agentId: <demo agent>, source: 'subscription' }, <now>)` (or the lower-level
   `repos.subscriptions.findLive` + `repos.agents.owner` calls it composes) resolves successfully
   for a free-active and a paid-active student, and returns the paused/ended students' rows as
   non-live via `findLive` returning the row with that status (confirms the seed is actually usable
   by 3.9's planned CLI chat demo, which depends on 1.5).

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

## Risky paths touched

Checked every planned path (including the two new files under `bin/` and the new test) against
`.claude/skills/merge-gate/risk-paths.txt`:

- `packages/db/src/repositories/**` — **not touched** by this plan (design deliberately uses
  `internal.ts` instead); if the build ends up adding or changing a repository method, that file
  becomes risky and needs **security-reviewer**, and the handoff needs a `risk: high` decision entry
  — flagged, not expected.
- `packages/db/src/identity/**` — not touched.
- `packages/contracts/**`, `docs/adr/**` — not touched.
- `packages/harness/src/guardrails/**`, `content/prompt-packs/**`, `content/skills/**`,
  `evals/suites/safety/**`, `evals/suites/locked/**`, `apps/worker/src/alerts/**`,
  `content/locales/**` — not touched (`content/demo-teacher/**` is read-only and is not one of
  these globs).
- `packages/harness/src/access/**`, `packages/payments/**`,
  `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `apps/web/app/api/auth/**`,
  `packages/gateway/src/keys/**` — not touched.
- `.claude/**`, `.github/**`, `.githooks/**` — not touched.

**None (checked against risk-paths.txt), as planned.** No `risk: high` decision entry is needed
unless the build deviates into `repositories/**`.

## Open questions (lead can decide; none blocks starting the build)

1. **No `age`/`birth-year` column exists anywhere in the schema — only `users.age_confirmed_at`
   (a timestamp) and the separate `consents` table (kind/version, no canonical kind strings yet —
   1.7, which defines them, is still `todo`).** So "ages ≥ 13; some 13–17" cannot be stored as a
   number today. Recommendation: set `ageConfirmedAt` to a fixed seed timestamp for every student
   (representing "age confirmed" as 1.1's column already allows), and represent the 13–17 split only
   in seed-script comments/synthetic names (never real data), skipping `consents` rows entirely
   since 1.7 hasn't defined what kind/version they'd hold. 1.7 can add real consent rows to these
   same fixed student ids later without conflicting with this seed's `onConflictDoNothing`.
2. **Exact id strings and the free/paid/paused/ended split (5 each) are the seed's own invention**
   (the task names the categories but not the count per category or any id scheme). Recommendation:
   5/5/5/5 as above, fixed slug-style ids (`demo-student-01`..`20`, `demo-package-free`, etc.) —
   reversible, code-only, no contracts/schema change.
3. **Root `"seed"` script wiring** — whether it should run through `turbo run seed --filter=
   @edmate/db` (needing a new `seed` entry in `turbo.json`) or a plain `pnpm --filter` chain as
   drafted above. Recommendation: the plain chain, to match `db:migrate`/`db:grant-role`'s existing
   "build once, then run the compiled CLI" convention and avoid a turbo-config change for one script;
   not blocking either way.
4. **`ModelPolicy`/`promptPackVersion` placeholder values for the seeded `AgentConfig`** (no real
   provider call happens at seed time, but the field is required and schema-validated).
   Recommendation: a plausible placeholder (e.g. `tiers: { small: {...}, main: {...} }` with
   `provider: 'anthropic'`) and `promptPackVersion: '1.0.0'`, `languages: ['en']` — cosmetic, easy to
   change later, not a contracts or behaviour decision.

## Decisions (filled in after lead answers; logged to docs/decisions/log.md on merge)

Pending.

Status: **READY** — nothing above blocks starting the build; all four open questions have a
recommended default the builder can take and log if the lead doesn't answer first.

## Lead answers (18 Oct 2026)

- Q1: fixed age-attestation timestamp only; no consent rows (1.7 adds age and consent). All fictional students are 13+ by attestation.
- Q2: accepted (fixed id scheme; 5 free, 5 paid-active, 5 paused, 5 ended). Fictional names, emails on `example.invalid`.
- Q3: a plain root `seed` script (no new turbo task).
- Q4: seeded AgentConfig uses the same provisional policy as 2.3's DEFAULT_MODEL_POLICY (Anthropic for both tiers, no fallback) and promptPackVersion `1.0.0` (3.11 publishes it); mark both provisional in a comment.
- Before your final push: merge origin/main, regenerate the lockfile, re-run gates.
