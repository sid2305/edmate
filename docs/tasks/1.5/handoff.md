# 1.5 handoff: demo seed

**Status:** DONE
**Branch:** `m1/1.5-seed`
**Worktree:** `.claude/worktrees/agent-a8a1e1e95acc14c67`

## Acceptance evidence

| Item | Evidence |
|---|---|
| `corepack pnpm seed` idempotent (compose Postgres published on 127.0.0.1:55432, scratch database `edmate_seed_demo`, migrated with `db:migrate`, dropped afterwards) | run 1 → `seed: inserted 55 rows` / `seed: users=21 teacherProfiles=1 courses=1 modules=5 styleCards=1 agents=1 agentVersions=1 packages=2 packageVersions=2 subscriptions=20`; run 2 → `seed: already seeded (inserted 0 rows)` / every table `=0` |
| Subscription split (psql on the scratch db after the runs) | `active demo-package-free-v1 5`, `active demo-package-paid-v1 5`, `paused demo-package-paid-v1 5`, `ended demo-package-free-v1 2`, `ended demo-package-paid-v1 3` |
| Root gates (all packages, after merging origin/main at `9e4b428`, which includes 2.7 and migration 0006; `pnpm install` left the lockfile unchanged) | `corepack pnpm turbo run typecheck lint test` → `Tasks: 40 successful, 40 total` |
| db tests (Postgres up) | `Test Files 18 passed (18)`, `Tests 382 passed (382)` (22 new: `seed.test.ts` 9, `seed-cli.test.ts` 6, `seed.int.test.ts` 7); coverage `All files 99.89 / 99.15 / 99.65 / 100`; `seed.ts` 100 / 100 / 100 / 100; `cli.ts` 100% lines |
| Seed runs repeated after the merge (fresh scratch db, migrations up to 0006) | run 1 → `seed: inserted 55 rows`; run 2 → `seed: already seeded (inserted 0 rows)` |
| Idempotency on real Postgres | `seed.int.test.ts`: run 1 inserts exactly the expected counts; run 2 inserts 0 everywhere, every id in every seeded table identical; the CLI on the same db prints "already seeded" |
| Rows usable | `seed.int.test.ts`: agent `live`/`liveVersion 1`, both packages `liveVersion 1`, configs pass `AgentConfigSchema`/`PackageConfigSchema`, `moduleIds` ⊆ the five seeded modules; join shows every subscription's package version is the demo teacher's; `entitlementStoreFor(...).resolve` gives free-active (2 allowed, 3 locked), paid-active (none locked), paused (status `paused`), ended (`null`) |
| Drift | `seed.int.test.ts`: an edited package version and style card are reported (`packageVersions demo-package-paid-v1`, `styleCards demo-style-card-v1`) and left unchanged |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no findings |
| Format | prettier clean on every changed file; `format:check` flags only `.github/workflows/ci.yml`, which is unchanged from main |

## Changes

- `packages/db/src/seed.ts`: `buildDemoSeed(content)` (pure: every row, contracts-validated, module ownership checked) and `seedDemoTeacher(db, { contentDir })` (one transaction, `ON CONFLICT (id) DO NOTHING` per table in FK order, then drift check). Exports `DEMO_IDS`, `DEMO_CONTENT_DIR`, `SEED_TABLES`, `DEMO_STUDENT_COUNT`. Imports schema and `Db` from `./internal.js` only.
- `packages/db/src/cli.ts`: `runSeedCli(env, log, seed?)`; reads `DATABASE_URL` and optional `EDMATE_SEED_CONTENT_DIR`; logs per-table counts, "already seeded" when 0, drift warnings; errors redacted.
- `packages/db/src/bin/seed.ts`: entry point. `packages/db/package.json`: `db:seed` script, `@edmate/content` dependency (lockfile updated).
- Root `package.json`: `seed` = build `@edmate/db` and its deps, then `db:seed`.
- `docker/env.example`: one comment on `corepack pnpm seed` needing `DATABASE_URL`.
- Tests: `packages/db/test/seed.test.ts`, `seed-cli.test.ts`, `seed.int.test.ts`.

Not touched: `repositories/**`, `identity/**`, contracts, migrations, `content/demo-teacher/**`, 2.7/3.6 files. No risky paths.

## Deviations

- The agent and packages are inserted already `live` / `liveVersion: 1` instead of draft-then-update (plan item 5). It's the same transaction, so no reader ever sees a live row without its version, and the seed never runs an `UPDATE` (plan item 8).
- Added a drift check the plan did not ask for: an existing seeded style card or agent/package config that differs from the content is reported as a warning and left alone (plan: nothing is updated), so changed content can't be silently ignored.
- Root `seed` uses `pnpm --filter "@edmate/db..." run build` (builds `@edmate/content` and `@edmate/contracts` first), not just `--filter @edmate/db build`, because the seed now needs content's `dist`.
- The compose Postgres doesn't publish a port by default, so to run `corepack pnpm seed` from the host you need the test override (`packages/db/test/compose.port.yaml`). The env.example note says so.
- One full test run failed partway with `database ... is being accessed by other users` / `terminating connection due to administrator command` from the shared `edmate-postgres-1` container (other sessions use it). A clean re-run passed (379/379); I dropped the five leftover throwaway dbs from the failed run (no connections on them). This was not caused by the seed.

## Decisions

### 18 Oct 2026 · 1.5 Demo seed ids, rows and subscription split · decided by builder (tdd-guide), lead answers Q1, Q2 · risk: low
Decided: fixed ids (`demo-teacher`, `demo-teacher-profile`, `demo-agent`, `demo-agent-v1`, `demo-style-card-v1`, `demo-package-{free,paid}`, `demo-package-{free,paid}-v1`, `demo-student-01..20`, `demo-subscription-01..20`); course and module ids are taken from `course.yaml`. Students 01–05 free active, 06–10 paid active, 11–15 paid paused, 16–20 ended (16–18 paid, 19–20 free). Live subscriptions end 2099-12-31; ended ones and `ageConfirmedAt` use a fixed 2026-01-01 time. No consent rows. Teacher `Demo Teacher`, `demo-teacher@example.invalid`, market `global`; profile slug `demo-teacher`, subject and bio from `course.yaml`, verification left at the default `pending`.
Why: fixed ids plus a fixed clock make re-runs byte-identical; the lead accepted 5/5/5/5 and attestation-only ages.
Alternatives: random ids looked up by email; a periodEnd computed from the current date.
Reversible: yes (code only).

### 18 Oct 2026 · 1.5 Seeded AgentConfig uses provisional policy and prompt pack 1.0.0 · decided by lead (answer Q4) · risk: low
Decided: Anthropic for both tiers (same models as the gateway's `DEFAULT_MODEL_POLICY`), no fallback, `promptPackVersion: '1.0.0'`, `languages: ['en']`; copied into `seed.ts` (db doesn't depend on gateway) and marked PROVISIONAL.
Why: the lead's answer; 7.6 settles the model mix and 3.11 publishes the prompt pack.
Alternatives: add a gateway dependency to db to import the constant.
Reversible: yes.

### 18 Oct 2026 · 1.5 Seed is insert-only and reports drift instead of fixing it · decided by builder (tdd-guide) · risk: low
Decided: one transaction; `ON CONFLICT (id) DO NOTHING` on every table; no updates or deletes. If a stored style card or agent/package config no longer matches the content, the seed warns (`seed: warning: existing row differs from content, left as is: <table> <id>`) and still exits 0. A conflict on anything other than the id (for example a seed email another user already has) fails the whole run and writes nothing.
Why: idempotent with no destructive SQL, and a stale demo db is visible instead of silently kept.
Alternatives: upsert and overwrite (breaks the "versions are immutable" rule); stay silent.
Reversible: yes.

### 18 Oct 2026 · 1.5 Root `seed` script is a plain pnpm chain · decided by lead (answer Q3) · risk: low
Decided: `"seed": "pnpm --filter \"@edmate/db...\" run build && pnpm --filter @edmate/db run db:seed"`; no turbo task. `EDMATE_SEED_CONTENT_DIR` overrides the content tree.
Why: matches the build-then-run pattern of `db:migrate` and `db:grant-role`.
Alternatives: a turbo `seed` task.
Reversible: yes.
