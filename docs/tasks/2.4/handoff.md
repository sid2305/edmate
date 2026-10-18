# 2.4 handoff: Metering (usage rows per call; prices.yaml in USD)

Status: DONE
Branch: `m2/2.4-metering`
Worktree: `.claude/worktrees/agent-acd71ca6af42e6b47` (under the main checkout)
Reviewers needed (risky path `packages/db/src/repositories/**`): security-reviewer (gate-required), database-reviewer, typescript-reviewer (lead answers).

## Acceptance evidence

Accept: "one row per call; cost per turn and per active student computed from the rows."

| Item | Evidence |
|---|---|
| One row per call | `gateway/test/metering/meteredGateway.test.ts` "records the reported usage once, priced, with the full context; chunks pass unchanged": one `sink.record` with `costMicroUsd: 33_000` (1,000 in x $3/M + 2,000 out x $15/M) and the full ctx; the caller's chunks are `toEqual` the scripted ones. A router 5xx failover inside one call is still one row. db: `usage-ledger.int.test.ts` reads every written row back with the right teacher, package, student, turn, source, model, tier, tokens and cost. |
| Failed or aborted attempts still metered | "usage then throws (stops early)": the row is recorded before the caller sees the error, and the error is the same object. "throws before any chunk": a flagged `no_usage_reported` row, no `tokens`. "abandons with break": exactly one row either way. Mutation check: moving the meter call out of `finally` fails these 3 tests. |
| No usage chunk at all | "completes with no usage chunk" leads to `recordUnmetered({ reason: 'no_usage_reported' })`. db: the row reads back with `model`, `inputTokens`, `outputTokens`, `costMicroUsd` all `null` (`status: 'unknown'`). |
| Unknown model | An unpriced row with real tokens and `reason: 'unpriced_model:mystery-model'`, plus exactly one warning `{ event: 'metering.unpriced_model', model }`. By default it is one JSON line on stderr with no student id and no prompt text. db: reads back with tokens and `costMicroUsd: null`. |
| Cost arithmetic | `gateway/test/pricing/pricing.test.ts`: exact BigInt math, e.g. 7 in x $0.8/M + 3 out x $4.000001/M = 17.600003, rounded half up to `18`; 1,234,567 + 89 tokens gives `988_010`. A missing model gives `undefined`. A negative, infinite, NaN, string, missing, extra-key or more-than-6-decimals price fails at load, naming the model and field. The bundled `prices.yaml` prices every model in `DEFAULT_MODEL_POLICY`. |
| Source carried through | Wrapper: `it.each` over `subscription`, `teacher_preview`, `eval`, for both `record` and `recordUnmetered`. db: `it.each` stores and reads back all three. |
| No student text | Wrapper: the sink receives only the five billing fields (an extra ctx key is dropped), and nothing the sink receives contains the prompt or system text. db: "writes carry only ids, the model, tier, counts and a reason code" spies on `pg.Client.prototype.query`, and every parameter sent by `record` / `recordUnmetered` (both kinds) is in an allowlist or is the row's UUID. |
| Isolation | 4 new `CASES` entries in `repositories.int.test.ts`: `usageLedger.record cases=28 leaks=0`, `recordUnmetered cases=32 leaks=0`, `listForTurn cases=36 leaks=0`, `sumForStudent cases=24 leaks=0`. Another teacher's package and a ghost student are both `not_found` with the row count unchanged. `usageMeterFor` refuses a ctx naming another pair (`scope`). Bad scopes throw before SQL (`scope.test.ts`, automatic, plus `usageMeterFor` at construction). |
| Cost per turn / per active student | "cost per turn and per active student are computed from the rows": one turn has a cut-short attempt (330), a retry (33,000), an unknown call and an unpriced call. `listForTurn` returns 4 rows summing to 33,330. The `sumForStudent` delta is `{calls 4, recorded 2, unknown 1, unpriced 1, cost 33,330, in 1,017, out 2,029}`, and its totals equal a raw-SQL aggregate for that pair and for the neighbouring pair. |
| DB keeps placeholders honest | "the database rejects a placeholder row…": 8 raw inserts violating the status rules (unknown with a model, a cost or no reason; unpriced with a cost or naming another model; recorded with a reason or an empty model; a negative cost) all fail with `23514`. |
| Coverage | gateway `src/metering/**` and `src/pricing/**` held at 100/100/100/100 (new thresholds). db `src/repositories/**` thresholds met (`usage-ledger.ts` 100 lines/functions/statements, 95.8 branches; repositories 99.23 branches). |

Commands (Postgres via `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`, stopped after):

```
corepack pnpm turbo run build typecheck lint test --filter=@edmate/gateway... --filter=@edmate/db...
→ gateway Tests 258 passed (258); db Tests 262 passed (262); Tasks: 19 successful, 19 total
   gateway src/metering 100/100/100/100, src/pricing 100/100/100/100; db All files 100 / 99.04 / 100 / 100

corepack pnpm turbo run typecheck lint test        (root, after merging origin/main)
→ Tasks: 35 successful, 35 total

python3 .githooks/secret-scan.py --all
→ exit 0, no findings

corepack pnpm run format:check
→ only .github/workflows/ci.yml flagged; it comes from main, untouched here
```

Merged `origin/main` (1.6 audit log, 3.13). Conflicts: `repositories/index.ts` (kept both `audit` and `usageLedger`, and both export blocks) and `repositories.int.test.ts` (main's file plus the four usage cases). 1.6 had taken migration `0002`, so this branch's migration was regenerated as `0003_usage_ledger_metering` on top of main's snapshot. The lockfile merged without conflict (`pnpm install --frozen-lockfile` clean).

## Changes

- `packages/gateway/src/pricing/`: `prices.yaml` (USD per 1M tokens: `claude-haiku-4-5` 1/5, `claude-sonnet-4-5` 3/15), `schema.ts` (Zod), `load.ts` (`parsePriceTable`, `loadBundledPrices`, `PriceTableError`), `cost.ts` (`computeCostMicroUsd`).
- `packages/gateway/src/metering/`: `types.ts` (`MeterContext`, `MeterSink`, `UnmeteredUsage`, `UnmeteredReason`, `MeteringWarning`) and `meteredGateway.ts` (`createMeteredGateway(gateway, sink, ctx, prices, { warn? })` returns a `MeteredGateway`, which is a `ModelGateway` plus `settled()`).
- `packages/gateway/src/index.ts`: exports both barrels. `package.json`: `js-yaml` 5.5.0 (the same pin as `@edmate/evals`), and the build copies `prices.yaml` into `dist/pricing/`. `tsconfig.build.json`: `types: ["node"]` (like db and evals). `vitest.config.ts`: 100% thresholds for the two new folders.
- `packages/db/src/schema/`: enums `entitlement_source` (checked equal to `Entitlement.source`) and `usage_status`. `usage_ledger` gains `turn_id` (not null, not a FK), `source`, `status` (default `recorded`), `reason`, an index on `(teacher_id, turn_id)`, and two CHECK constraints.
- `packages/db/migrations/0003_usage_ledger_metering.sql` + snapshot + journal (generated; CREATE TYPE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT only).
- `packages/db/src/repositories/usage-ledger.ts`: `record`, `recordUnmetered`, `listForTurn`, `sumForStudent`. `ports.ts`: `usageMeterFor(repos, scope)`. `index.ts`: wired in and exported. `README.md`: UsageMeter section.
- Tests: `gateway/test/pricing/pricing.test.ts`, `gateway/test/metering/meteredGateway.test.ts`, `keys/exports.test.ts` (new exports), `db/test/usage-ledger.int.test.ts` (new, own throwaway database), `repositories.int.test.ts` (4 CASES), `isolation-seed.ts` (one usage row per pair), `schema.test.ts`, `scope.test.ts`.

## Deviations from the plan

- **The token/cost columns stay NOT NULL; unknown figures are placeholders pinned by a CHECK and read back as `null`.** The plan relaxed `NOT NULL`, but `ALTER … DROP NOT NULL` matches the create-only guard (`test/schema.test.ts` and the merge gate's `DESTRUCTIVE_SQL`), and the task prompt says create-only. See decisions.
- `recordUnmetered` also carries `tier` (and `model` when unpriced), because `usage_ledger.tier` and `model` are NOT NULL. `embed()` has no tier in the port, so it is recorded on `main`, the tier the router uses for it.
- `generateObject()` / `embed()` always take the `no_usage_reported` path: the port returns only the value, so the wrapper has no usage to read. A "generic in case an adapter adds usage" path would need a port change, so it is not built.
- The wrapper returns `MeteredGateway` (`ModelGateway` + `settled()`), and sink writes are not awaited by the call. See decisions.
- Reads are `listForTurn` and `sumForStudent` (per student x teacher). There is no teacher-wide total yet; that is 13.5's.

## Decisions

### 18 Oct 2026 · 2.4 Unknown usage is a flagged row with placeholder figures, not NULL columns · decided by builder · risk: high
Decided: `usage_ledger` keeps 1.1's NOT NULL `model`, `input_tokens`, `output_tokens` and `cost_micro_usd`. Each row has a `status` (`recorded` | `unknown` | `unpriced`) and a fixed `reason` (`no_usage_reported` | `unpriced_model:<model>`). An `unknown` row stores `''`/`0`/`0`/`0`, and an `unpriced` row stores real tokens with cost `0`. A CHECK constraint (NULL-safe, `is not distinct from`) pins those placeholders to their status, so a placeholder can never pass as a priced or free call. The repository returns them as `null`, and `sumForStudent` reports `unknown`/`unpriced` counts next to the priced cost.
Why: the plan's `DROP NOT NULL` is flagged as destructive by both the db package's create-only test and the merge gate's regex, and the task prompt said create-only. Rows still say "unknown", never "free", at both the API and the constraint level.
Alternatives: relax NOT NULL in a migration the merge gate flags (needs database-reviewer plus an exception in `schema.test.ts`'s create-only check); new nullable columns next to the old ones (duplicated meaning).
Reversible: yes. A later migration can drop NOT NULL and turn the placeholders into NULL in one statement, gated on the CHECK's status.
Note for 2.5/13.5: anything that reads the table directly must filter on `status` (or use `sumForStudent`). A raw `sum(cost_micro_usd)` quietly leaves out unknown calls, just as a NULL sum would.

### 18 Oct 2026 · 2.4 usage_ledger writes are ownership-checked through the package, scoped by student x teacher · decided by builder · risk: high
Decided: `usageLedger.record` / `recordUnmetered(scope: StudentScope, packageId, entry)` insert with `INSERT … SELECT … FROM packages WHERE id = $pkg AND teacher_id = $scope.teacherId` (0 rows → `not_found`). The student id is the scope's, and a ghost student is a FK violation, which reads as `not_found`. Reads filter on `teacher_id` and `student_id` from the scope. `usageMeterFor(repos, scope)` binds one pair, and a ctx naming another teacher or student is `scope`. Rows hold ids, model id, tier, counts, cost and the reason code only.
Why: money/metering data per teacher and student follows 1.2's isolation rules exactly. Binding the scope at construction (like `transcriptStoreFor`) means a wrong ctx can't bill another pair.
Alternatives: trust the ctx's ids per call with no bound scope (simpler, but a bug in the caller could bill another pair).
Reversible: yes.

### 18 Oct 2026 · 2.4 Metering writes are fire-and-track; a failing sink is logged, never thrown · decided by builder · risk: low
Decided: the wrapper starts the sink write when a call ends (normal end, throw, or early `break`) and doesn't await it. `settled()` waits for outstanding writes. A sink rejection or sync throw becomes one `metering.failed` warning with the error's class name only, so a driver message that quotes parameters is never logged.
Why: pipeline step 10 says metering never blocks. 3.7 can await `settled()` at the end of a turn or job if it wants durability before it replies.
Alternatives: await the sink before the stream finishes (adds DB latency to every turn).
Reversible: yes.

### 18 Oct 2026 · 2.4 Every usage chunk in a stream is its own row; generateObject/embed are always "unknown" · decided by builder · risk: low
Decided: a stream that reports more than one usage figure writes one row per figure (in practice there is one; the router never splices). `generateObject`/`embed` record `no_usage_reported` on every call, because the frozen port gives the wrapper no usage for them. Chunks pass through unchanged: the usage chunk still says `costMicroUsd: 0`, and the priced cost is only in the row. 3.7 can call `computeCostMicroUsd` if it needs the cost mid-turn.
Why: no tokens are dropped and none are invented. The plan asked for byte-identical chunks.
Alternatives: sum several figures into one row (loses the per-model split); carry usage out of `generateObject` (contracts change, ADR).
Reversible: yes.

### 18 Oct 2026 · 2.4 Prices are integer micro-USD per 1M tokens, at most 6 decimals, half-up once · decided by builder · risk: low
Decided: `prices.yaml` prices are plain USD per 1M tokens with at most 6 decimal places, scaled to BigInt micro-USD per 1M tokens at load. Cost = (in x pIn + out x pOut) / 1M, rounded half up once per call; a result past 2^53 throws. `js-yaml` 5.5.0 (the same pin as `@edmate/evals`) parses the file. The build copies `prices.yaml` into `dist/`, and `load.ts` resolves it from `import.meta.url`. The gateway's build tsconfig now includes node types, like db and evals. The prices in the file are list prices at the time of writing and should be checked when 7.6 sets the model mix.
Why: exact integers with no float drift; one rounding step.
Alternatives: round each side separately (can differ by 1); floats.
Reversible: yes.

### 18 Oct 2026 · 2.4 turn_id is a plain column; source is a new enum checked against the contracts · decided by planner · risk: low
Decided: `usage_ledger.turn_id` is text, not null and not a foreign key (meter and commit are independent async steps). `source` uses a new `entitlement_source` enum that `schema.test.ts` checks equals `Entitlement.source`. Index `(teacher_id, turn_id)` serves `listForTurn`.
Why: as planned.
Alternatives: FK to turn traces (would couple metering to the trace write).
Reversible: yes.

Ops note: `docker compose … up -d postgres` reported "Recreated" for the shared `edmate-postgres-1` container (compose project shared across worktrees). If another session was running db integration tests at that moment, they may have seen a dropped connection. The container was stopped after.
