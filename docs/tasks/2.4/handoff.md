# 2.4 handoff: Metering (usage rows per call; prices.yaml in USD)

Status: DONE (fix round 1 applied)
Branch: `m2/2.4-metering`
Worktree: `.claude/worktrees/agent-acd71ca6af42e6b47` (under the main checkout)
Reviewers needed (risky path `packages/db/src/repositories/**`, plus a migration the gate reads as destructive: `ALTER COLUMN … DROP NOT NULL`): security-reviewer, database-reviewer (both gate-required), typescript-reviewer (lead answers).

## Fix round 1

| Finding | Fix | Test |
|---|---|---|
| [CRITICAL, database] unknown/unpriced rows stored `0`/`''` placeholders in NOT NULL columns | `model`, `input_tokens`, `output_tokens`, `cost_micro_usd` are nullable (`0003`: `ALTER COLUMN … DROP NOT NULL`, which loses no data; the table is empty). Unknown rows store NULL tokens and cost; unpriced rows store NULL cost. The repository's null translation is gone: rows are returned as stored. | `usage-ledger.int.test.ts` "unknown usage reads back as null figures…" reads the raw table: cost is NULL on every non-recorded row, and tokens are NULL on unknown rows. `schema.test.ts` checks the four columns are nullable. |
| [HIGH, database] brittle 3-branch CHECK | Replaced by `usage_ledger_recorded_has_figures` (`status <> 'recorded' or` all four figures are not null). `usage_ledger_counts_non_negative` stays. Status/figure consistency for other statuses is checked on read (`integrity`), not in SQL. | "the database rejects a recorded row with a missing figure, and negative counts": 7 raw inserts fail with `23514`; unknown-all-NULL and unpriced-NULL-cost rows are accepted. The integrity test covers 3 hand-made rows whose figures contradict their status. |
| [MEDIUM, database] index for `sumForStudent` | `usage_ledger_teacher_id_student_id_created_at_idx` on `(teacher_id, student_id, created_at)`, which also serves 2.5's rolling windows. | `schema.test.ts` index test. |
| [CRITICAL, silent-failure] a failed-over primary got no row | Metering now wraps each adapter, not the router: `meterRouter(router, sink, ctx, prices)` rebuilds the router with `Router.withAdapters(a => meterAdapter(a, meter))`. Every attempt that reached an adapter writes exactly one row (priced, unpriced or unknown), and unknown rows carry the attempted adapter's model. `createMeteredGateway` is removed so a whole router can't be wrapped by mistake. | `meteredGateway.test.ts`: "a router failover meters both attempts" (primary unknown on `primary-model` plus fallback priced at 33,000; this replaces the old "only the fallback" test). Also: generateObject/embed failovers write 4 rows; a request the router refuses before any provider call writes none; a primary that streamed usage and then failed keeps its priced row with no failover. `router.test.ts`: `withAdapters` maps tiers and fallback, and a shared adapter only once. |
| `schema.test.ts` create-only guard | `ALTER TABLE "t" ALTER COLUMN "c" DROP NOT NULL;` is stripped before the destructive check (lead clarification: create-only means never lose data). A new test pins the exact list of relaxed columns (the four `usage_ledger` columns in `0003`), so any future relaxation is visible. | `schema.test.ts` "relaxes NOT NULL only where a reviewed task did". |

## Acceptance evidence

Accept: "one row per call; cost per turn and per active student computed from the rows."

| Item | Evidence |
|---|---|
| One row per provider attempt | `gateway/test/metering/meteredGateway.test.ts` "records the reported usage once, priced, with the full context; chunks pass unchanged": one `sink.record` with `costMicroUsd: 33_000` and the full ctx; the caller's chunks are `toEqual` the scripted ones. A failover writes one row per attempt (see fix round 1). db: every written row reads back with the right teacher, package, student, turn, source, model, tier, tokens and cost. |
| Failed or aborted attempts still metered | "usage then throws (stops early)": recorded before the caller sees the error, which is the same object. "throws before any chunk": an unknown row on the adapter's model, no `tokens`. "abandons with break": exactly one row either way. |
| No usage chunk at all | `recordUnmetered({ reason: 'no_usage_reported', model: <adapter model> })`. db: tokens and cost are stored and read back as NULL. |
| Unknown model | An unpriced row with real tokens, NULL cost and `reason: 'unpriced_model:<model>'`, plus one `metering.unpriced_model` warning (a JSON line on stderr by default, with no student id and no prompt text). |
| Cost arithmetic | `pricing.test.ts`: exact BigInt micro-USD (e.g. 7 in x $0.8/M + 3 out x $4.000001/M = 17.600003, rounded to 18). A malformed `prices.yaml` fails at load, naming the model and field. The bundled file prices every model in `DEFAULT_MODEL_POLICY`. |
| Source carried through | Wrapper and db: `it.each` over `subscription`, `teacher_preview`, `eval`. |
| No student text | The sink receives only the five billing fields. db spies on `pg.Client.prototype.query`: every parameter that `record` / `recordUnmetered` send is in an allowlist (ids, model, tier, counts, reason, null) or is the row's UUID. |
| Isolation | 4 `CASES` entries (`usageLedger.record cases=28`, `recordUnmetered cases=32`, `listForTurn cases=36`, `sumForStudent cases=24`; all `leaks=0`). Another teacher's package and a ghost student are `not_found`. `usageMeterFor` refuses a ctx naming another pair. Bad scopes throw before SQL. |
| Cost per turn / per active student | "cost per turn and per active student are computed from the rows": 4 rows on one turn sum to 33,330. The `sumForStudent` delta is `{calls 4, recorded 2, unknown 1, unpriced 1, cost 33,330, in 1,017, out 2,029}`, and totals equal a raw-SQL aggregate for this pair and the neighbouring one. |
| Coverage | gateway `src/metering/**`, `src/pricing/**`, `src/router/**` 100/100/100/100. db All files 100 / 99.05 / 100 / 100 (`usage-ledger.ts` 96.15 branches; the repositories threshold is 90). |

Commands (Postgres via `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml start postgres`, stopped after):

```
corepack pnpm turbo run build typecheck lint test --filter=@edmate/gateway... --filter=@edmate/db...
→ gateway Tests 264 passed (264); db Tests 265 passed (265); Tasks: 19 successful, 19 total

corepack pnpm turbo run typecheck lint test        (root, after merging origin/main)
→ Tasks: 35 successful, 35 total

python3 .githooks/secret-scan.py --all
→ exit 0

corepack pnpm run format:check
→ only .github/workflows/ci.yml flagged; it comes from main, untouched here
```

Merged `origin/main` again for fix round 1 (docs only, no conflicts). In round 0, 1.6 had taken migration `0002`, so this branch's migration is `0003_usage_ledger_metering`. It is not on main yet, so it was regenerated in place for round 1.

## Changes

- `packages/gateway/src/pricing/`: `prices.yaml`, `schema.ts`, `load.ts` (`parsePriceTable`, `loadBundledPrices`, `PriceTableError`), `cost.ts` (`computeCostMicroUsd`).
- `packages/gateway/src/metering/`: `types.ts` (`MeterContext`, `MeterSink`, `UnmeteredUsage` (`model` now required), `UnmeteredReason`, `MeteringWarning`). `meteredGateway.ts`: `createMeter(sink, ctx, prices, { warn? })` returns a `Meter` (`attempt`, `settled`); `meterAdapter(adapter, meter)`; `meterRouter(router, sink, ctx, prices, opts?)` returns a `MeteredGateway` (`ModelGateway` + `settled()`).
- `packages/gateway/src/router/router.ts`: `Router.withAdapters(map)`, which returns the same routing over mapped adapters.
- `packages/gateway`: `js-yaml` 5.5.0 (the same pin as evals); the build copies `prices.yaml` to `dist/`; the build tsconfig includes node types; 100% thresholds for `metering`/`pricing`.
- `packages/db/src/schema/`: enums `entitlement_source`, `usage_status`. `usage_ledger`: nullable `model`/`input_tokens`/`output_tokens`/`cost_micro_usd`; new `turn_id`, `source`, `status`, `reason`; indexes `(teacher_id, turn_id)` and `(teacher_id, student_id, created_at)`; CHECKs `counts_non_negative` and `recorded_has_figures`.
- `packages/db/migrations/0003_usage_ledger_metering.sql` + snapshot + journal (generated).
- `packages/db/src/repositories/usage-ledger.ts` (`record`, `recordUnmetered`, `listForTurn`, `sumForStudent`), `ports.ts` (`usageMeterFor`), `index.ts`, `README.md`.
- Tests: `pricing.test.ts`, `meteredGateway.test.ts`, `router.test.ts`, `exports.test.ts`, `usage-ledger.int.test.ts`, `repositories.int.test.ts`, `isolation-seed.ts`, `schema.test.ts`, `scope.test.ts`.

## Deviations from the plan

- Metering wraps adapters (`meterRouter`), not a whole `ModelGateway` (`createMeteredGateway` in the plan), so that every provider attempt is metered (fix round 1).
- `schema.test.ts`'s create-only guard now allows `ALTER COLUMN … DROP NOT NULL`, with the exact relaxed columns pinned by a test.
- `recordUnmetered` also carries `tier` and the attempted `model`. `embed()` is recorded on `main`, the tier the router uses for it.
- Reads are `listForTurn` and `sumForStudent` (per student x teacher). There is no teacher-wide total yet; that is 13.5's.

## Decisions

### 18 Oct 2026 · 2.4 Unknown figures are NULL; usage_ledger's figure columns are relaxed to nullable · decided by team lead · risk: high
Decided: `model`, `input_tokens`, `output_tokens` and `cost_micro_usd` are nullable (migration `0003`, `ALTER COLUMN … DROP NOT NULL`, which loses no data; the table is empty). Each row has a `status` (`recorded` | `unknown` | `unpriced`) and a fixed `reason` (`no_usage_reported` | `unpriced_model:<model>`). Unknown rows have NULL tokens and cost; unpriced rows have NULL cost. One CHECK requires a recorded row to have all four figures, and another keeps counts non-negative. Status/figure consistency beyond that is validated on read (`integrity`). `schema.test.ts` allows relaxing NOT NULL and pins the relaxed columns.
Why: a raw query must never read an unknown call as free (database-reviewer, fix round 1). The lead clarified that "create-only" means "never lose data". Round 0's placeholder-plus-3-branch-CHECK design was replaced.
Alternatives: placeholders pinned by a CHECK (round 0: brittle, and raw readers see 0).
Reversible: yes (re-adding NOT NULL needs the unknown rows backfilled or removed).
Note for 2.5/13.5: `sum()` skips NULL, so totals leave out unknown calls. Report the `unknown`/`unpriced` counts (as `sumForStudent` does) next to any cost.

### 18 Oct 2026 · 2.4 One usage row per provider attempt, metered at the adapter · decided by builder · risk: high
Decided: `meterRouter(router, …)` rebuilds the router with `Router.withAdapters` so that each adapter call is metered. A failed-over primary writes its own row (unknown, on its model) next to the fallback's. A request the router refuses before any adapter call writes nothing. The gateway-level wrapper was removed so a router can't be metered as one opaque call.
Why: silent-failure-hunter, fix round 1. Tokens a failed primary spent were invisible.
Alternatives: record inside `Router` itself (couples routing to billing); keep a gateway-level wrapper too (easy to misuse).
Reversible: yes.

### 18 Oct 2026 · 2.4 usage_ledger writes are ownership-checked through the package, scoped by student x teacher · decided by builder · risk: high
Decided: `usageLedger.record` / `recordUnmetered(scope: StudentScope, packageId, entry)` insert with `INSERT … SELECT … FROM packages WHERE id = $pkg AND teacher_id = $scope.teacherId` (0 rows → `not_found`; a ghost student is a FK violation, which reads as `not_found`). Reads filter on the scope's teacher and student. `usageMeterFor(repos, scope)` binds one pair, and a ctx naming another is `scope`. Rows hold ids, model id, tier, counts, cost and the reason code only.
Why: 1.2's isolation rules. A wrong ctx can't bill another pair.
Alternatives: trust the ctx's ids per call.
Reversible: yes.

### 18 Oct 2026 · 2.4 Metering writes are fire-and-track; durable retry is deferred to 3.8 · decided by team lead · risk: low
Decided: a sink write starts when an attempt ends and is not awaited by the call. `settled()` waits for outstanding writes. A failing write becomes one `metering.failed` warning (error class name only) and is not retried. Durable retry or a dead-letter queue for failed meter writes is deferred to task 3.8 (the async `meter` step's queue).
Why: pipeline step 10 says metering never blocks; 3.8 owns the queue.
Alternatives: await the write in the call path; retry in memory (lost on restart anyway).
Reversible: yes.

### 18 Oct 2026 · 2.4 generateObject/embed are always recorded as unknown (known limit) · decided by team lead · risk: low
Decided: the frozen `ModelGateway` port returns only the value from `generateObject`/`embed`, so each attempt is recorded as `no_usage_reported` on the adapter's model. Carrying usage out needs a contracts change (ADR). A stream that reports several usage figures writes one row per figure. Chunks pass through unchanged (the usage chunk still says `costMicroUsd: 0`); `computeCostMicroUsd` is exported if 3.7 needs a cost mid-turn.
Why: no tokens invented, no call left out.
Alternatives: a contracts change to return usage.
Reversible: yes.

### 18 Oct 2026 · 2.4 Prices are integer micro-USD per 1M tokens, at most 6 decimals, half-up once · decided by builder · risk: low
Decided: `prices.yaml` holds USD per 1M tokens (at most 6 decimals), scaled to BigInt micro-USD at load. Cost = (in x pIn + out x pOut) / 1M, rounded half up once; a result past 2^53 throws. `js-yaml` 5.5.0 (the same pin as evals). The build copies `prices.yaml` to `dist/`. The gateway build tsconfig includes node types. The list prices should be checked when 7.6 sets the model mix.
Why: exact integers, one rounding step.
Alternatives: floats; per-side rounding.
Reversible: yes.

### 18 Oct 2026 · 2.4 turn_id is a plain column; source is a new enum checked against the contracts · decided by planner · risk: low
Decided: `turn_id` is text, not null and not a FK (meter and commit are independent). `entitlement_source` is checked equal to `Entitlement.source`. Indexes `(teacher_id, turn_id)` for `listForTurn` and `(teacher_id, student_id, created_at)` for `sumForStudent` and 2.5.
Why: as planned, plus database-reviewer's index.
Alternatives: FK to turn traces.
Reversible: yes.

Ops note: in round 0, `docker compose … up -d postgres` reported "Recreated" for the shared `edmate-postgres-1` container. Round 1 used `start`/`stop` only.

### 18 Oct 2026 · 2.4 Review · decided by team lead · risk: low
Decided: generateObject and embed calls in packages/gateway/src/metering/meteredGateway.ts are recorded with status unknown, because the contracts port returns no usage for them; failed meter writes are retried by the worker queue in 3.8; 3.7 derives `source` from the entitlement.
Why: Adding usage to those port methods is a contracts change worth doing only if the cost data in 7.6 shows it matters.
Alternatives: A contracts change now.
Reversible: Yes.
