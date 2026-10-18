# Task 2.4: Metering: usage rows per call with teacher, package, student and source; `prices.yaml` in USD

Board: `python3 .claude/skills/board/board.py show 2.4` · Milestone M2 · deps: 1.1, 2.2, M0 · branch `m2/2.4-metering` · risk: touches a risky path (see below).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Metering: usage rows per call with teacher, package, student and source; `prices.yaml` in USD."
Accept: "one row per call; cost per turn and per active student computed from the rows."

Spec it must honour:
- Build plan § Model gateway (prose): "every call writes a `usage_ledger` row (`teacher_id, package_id, student_id, model, tier, tokens, cost_micro_usd, turn_id`); `prices.yaml` holds USD per 1M tokens; dashboards convert to the package's currency to show cost per active student against price."
- Build plan § Data model table: `usage_ledger` columns `teacher_id, package_id, student_id, model, tier, tokens, cost_micro_usd` → "Caps and dashboards" (2.5, 13.5).
- Turn pipeline spec, step 10 `meter`: "Usage rows (cost in USD micro-units; teacher preview billed to the teacher, evals to Edmate) | — | async | Queue; never blocks."
- Contracts (`packages/contracts/src/shared.ts`): `UsageSchema = { model, tier: 'small'|'main', inputTokens: count(), outputTokens: count(), costMicroUsd: count() }` — all three numeric fields are non-negative **integers**; there is no "unknown" variant.
- Contracts (`packages/contracts/src/ports.ts`): `UsageMeter.record(u: Usage, ctx: { teacherId; packageId; studentId; turnId; source: Entitlement['source'] }): Promise<void>` — frozen, unchanged by this task.
- Decision log, 18 Oct 2026, "2.2 No usage chunk when usage is unknown": `stream()` emits a `usage` chunk only when the provider reports both token counts; **a turn can end with no usage chunk at all** — "treat that as 'usage unknown' (flag it, don't record it as free)." `sdk-adapter.ts` already says `costMicroUsd: 0` on the chunk it does emit, commented "Priced by metering (task 2.4), not here" — so this task, not 2.2/2.3, turns `inputTokens`/`outputTokens` into a real `costMicroUsd`.
- Decision log, 18 Oct 2026, "2.2 Output that stops early is a failure": `stream()` yields whatever it already streamed **and the usage chunk**, then throws a non-retryable `GatewayError`. Spent tokens must still reach metering even though the call "failed".
- Decision log, 18 Oct 2026, "3.1 Review" (team lead): "failed-attempt usage is metered by the orchestrator (3.7)" — i.e. **3.7 calls** whatever this task builds; this task owns building the thing that meters every call, not wiring it into the pipeline.
- `docs/tasks/3.1/review.md`, deferred [LOW] finding: "usage from a failed `generate` attempt isn't metered; the orchestrator must meter it" — confirms the above split.
- `packages/db/src/repositories/README.md`: "Other port adapters (… UsageMeter 2.4 …) belong to their tasks and must add their isolation cases here" — the db adapter follows the exact scoped-repository rules from 1.2 (scope first, validated, in the WHERE clause; driver errors scrubbed; no raw SQL; rows parsed on the way out).
- Rule 2 (contracts frozen): nothing here changes `packages/contracts/**`. See Design for how "unknown usage" and "unpriced model" are represented without touching `Usage`/`UsageMeter`.
- Rule 3 (harness purity): the metering wrapper lives in `packages/gateway` (like the router, 2.3), not `packages/harness` — gateway has no import restriction. The harness/orchestrator (3.7) only ever sees a plain `ModelGateway`, exactly as it does today with the router.
- Rule 4: no real model or payment calls in tests; the scripted gateway (`@edmate/harness/testing`, reused as a devDependency the same way 2.3 did) and fixtures only.
- Out of bounds per the task prompt: caps (rolling 24h message limit, monthly cost alarm) are task 2.5 — this task only produces rows 2.5 can later query.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| One row per call | A metered `ModelGateway.stream()`/`generateObject()`/`embed()` call that completes normally with a usage chunk writes exactly one `usage_ledger` row with real `model`, `tier`, `inputTokens`, `outputTokens`, `costMicroUsd`, `teacherId`, `packageId`, `studentId`, `turnId`, `source`. |
| Failed/aborted attempts still metered | `stream()` yields a `usage` chunk then throws (2.2's "output that stops early" fixture) → the wrapper still records that usage before the error propagates to the caller unchanged. A call that throws with **zero** chunks yielded (e.g. a network failure before any usage chunk) records a flagged "unknown" row, never a zero-cost row. |
| No usage chunk at all | A scripted call that completes successfully but never yields a `usage` chunk (2.2's documented gap for `@ai-sdk/openai-compatible`'s partial-usage zero-fill) records a flagged "unknown" row — `inputTokens`/`outputTokens`/`costMicroUsd` are `null`, not `0`, and a `reason` says why. |
| Unknown model | A usage chunk names a model absent from `prices.yaml` → the row is written with real token counts and `costMicroUsd: null`, flagged `reason: 'unpriced_model:<model>'`, and a loud log line is emitted (model named, no student data). The call's own result (text/error) is unaffected — metering never blocks or fails the turn. |
| Cost arithmetic | `prices.yaml` fixtures (one priced model, one missing) prove `computeCostMicroUsd` does exact integer micro-USD math (no floats) for a round-number and an odd-token-count case, and rejects a malformed `prices.yaml` (negative price, wrong shape) at load time via its Zod schema, naming the bad entry. |
| Source carried through | `ctx.source` (`subscription` \| `teacher_preview` \| `eval`) passed to the wrapper lands unchanged in the stored row, for all three values. |
| No student text | The wrapper and the db adapter never receive or store `ModelRequest.messages`/`system` text or any student-identifying free text; the stored row's only strings are `model`, `teacherId`, `packageId`, `studentId`, `turnId`, `source`, and the flag `reason` (which names a model id or a fixed reason code, never request content). A test asserts the insert SQL's parameter list contains no text from the fixtures' prompts. |
| Isolation | Postgres integration test: another teacher's / student's usage rows are invisible to a read scoped to a different teacher/student; a write with a `packageId` that isn't the scope's teacher's package fails closed (`not_found`), matching the 1.2 pattern. |
| Cost per turn / per active student | A small aggregate read (e.g. `usageLedger.listForTurn`, `usageLedger.sumForStudent`) over seeded rows proves cost-per-turn and cost-per-student are computable by summing `costMicroUsd` over the rows — the full dashboard is 13.5's job, but the accept line ("computed from the rows") needs this much proven here. |
| Coverage | `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --filter=@edmate/db...` green; `packages/db/src/repositories/**` integration coverage thresholds (1.2's pattern) still met with the new repo included. |

## Design

### What exists already (1.1, 1.2, 2.2, 2.3, 2.6 — nothing here changes it)
- `usage_ledger` table (`packages/db/src/schema/learning.ts`, from 1.1) already has `teacher_id, package_id (FK packages.id), student_id, model, tier (model_tier enum), input_tokens, output_tokens, cost_micro_usd (bigint)`. **It has no `turn_id` and no `source` column** — both are required by `UsageMeter.record`'s `ctx` and by the build plan's own `usage_ledger` column list. This task adds them in an additive migration (see Files).
- `sdk-adapter.ts` (2.2) only ever yields a `usage` `ModelChunk` when the provider reported both token counts as safe integers; `costMicroUsd` on that chunk is always `0`, explicitly deferred to this task. When usage is unknown, **no chunk is yielded at all** — there is no "Usage object with unknown fields" anywhere in the system today; "unknown" is the *absence* of a usage chunk, not a value inside one.
- `Router` (2.3) is itself a `ModelGateway`; it transparently re-yields whatever the chosen adapter(s) yield, including their `usage` chunk(s), and performs its own single fallback retry inside one `stream()` call (so a 5xx failover is invisible to a caller as a single call, already metered once by this task's wrapper, not twice).
- 3.1's pipeline step 8 (`generate`) retries once on the fallback model as a **second, separate call** (`replace ''` before retrying) when the first attempt is truncated, times out, or the orchestrator aborts it for cost — this is the orchestrator-level retry the 3.1 review deferred to 3.7/2.4, distinct from the Router's own 5xx failover. Each such attempt is its own top-level call to whatever `ModelGateway` the orchestrator holds.
- Repository pattern (1.2): scope first (`teacherScope`/`studentScope`), validated before any SQL, in the WHERE clause of the same statement; ownership checked via `INSERT … SELECT … FROM <owner> WHERE …` (zero rows → `not_found`); every method wrapped in `guarded()` by `createRepositories`; rows parsed back through a Zod schema; no raw SQL strings.

### Where "unknown" lives: beside the port, not inside it

Exactly like 2.2's `AdapterCapabilities` (decision log: "Capabilities live beside the port, not inside it … no contract change means no ADR"), this task adds a **gateway-local type**, not a contracts change:

```ts
// packages/gateway/src/metering/types.ts
import type { Entitlement, Usage } from '@edmate/contracts';

export interface MeterContext {
  teacherId: string; packageId: string; studentId: string; turnId: string;
  source: Entitlement['source'];
}

/** What the metering wrapper needs from a sink. A `@edmate/db` adapter implements both this
 *  and the frozen `UsageMeter` port — `record` here is literally `UsageMeter.record`. */
export interface MeterSink {
  record(u: Usage, ctx: MeterContext): Promise<void>;
  /** Tokens unknown (no usage chunk at all), or tokens known but the model has no price. Never
   *  stored as a zero-cost Usage row. */
  recordUnmetered(
    ctx: MeterContext & {
      reason: 'no_usage_reported' | `unpriced_model:${string}`;
      tokens?: { inputTokens: number; outputTokens: number };
    },
  ): Promise<void>;
}
```

`UsageMeter` and `Usage` in `packages/contracts` are untouched. A caller that only has a plain `UsageMeter` (e.g. a future direct use outside this wrapper) can still use `record`; only the gateway's own wrapper needs `recordUnmetered`, and only the `@edmate/db` adapter needs to implement it. No ADR.

### `prices.yaml` and cost (`packages/gateway/src/pricing/`)

- `prices.yaml`: one entry per model id, prices in **plain USD per 1,000,000 tokens** as the build plan says (e.g. `inputUsdPerMillion: 3.00`), kept as repo-readable config, not generated.
- `schema.ts`: `PriceTableSchema` (Zod) — a record of model id → `{ inputUsdPerMillion: nonnegative finite number; outputUsdPerMillion: nonnegative finite number }`; rejects negative/non-finite/extra keys; parsed once at load.
- `load.ts`: reads and parses the bundled YAML (via a small YAML dependency, see Decisions) into a `PriceTable`; a malformed file throws naming the bad model id, at load time (fail fast, like `keys/load.ts`).
- `cost.ts`: `computeCostMicroUsd(table, model, inputTokens, outputTokens): number | undefined` — `undefined` means "no price for this model"; does the multiply in integer micro-USD (`Math.round(inputTokens * priceMicroUsdPerToken)` with the price itself pre-scaled to an integer at load time) so the stored `costMicroUsd` is always an exact integer, never a float rounding surprise.

### The metering wrapper (`packages/gateway/src/metering/meteredGateway.ts`)

```ts
export function createMeteredGateway(
  gateway: ModelGateway, sink: MeterSink, ctx: MeterContext, prices: PriceTable,
): ModelGateway
```

- Implements `ModelGateway` itself (same shape as `Router`), so it drops in anywhere a `ModelGateway` is expected — including as what 3.7's orchestrator calls directly for each of its own attempts (one `createMeteredGateway(...)` per attempt, or one instance reused across attempts; left to 3.7's wiring, since `ctx.turnId` is the same for both of a turn's attempts either way).
- `stream()`: a `try`/`finally`-wrapped async generator that re-yields every chunk from the wrapped gateway unchanged (transparent pass-through, including on an early `break` by the caller — `finally` still runs, matching 2.2's own abort-on-early-stop pattern). It tracks whether a `usage` chunk was seen.
  - Usage chunk seen → on completion (success *or* the wrapped call throwing afterward, 2.2's "stops early" case) compute cost via `prices` and call `sink.record(usage-with-real-cost, ctx)`; re-throw whatever the wrapped call threw, unchanged.
  - No usage chunk ever seen, call succeeds or throws → `sink.recordUnmetered({ ...ctx, reason: 'no_usage_reported' })`; propagate the result/error unchanged.
  - Usage chunk seen but `model` absent from `prices` → `sink.recordUnmetered({ ...ctx, reason: `unpriced_model:${model}`, tokens: { inputTokens, outputTokens } })` plus one loud log line (model id only); propagate the result/error unchanged.
- `generateObject()`/`embed()`: same three-way split, without streaming — the call either resolves/rejects with or without a usable usage figure (today's adapters report no usage at all for these two methods, so in practice they currently always take the `recordUnmetered('no_usage_reported')` path; the wrapper is written generically in case a future adapter adds usage there).
- Metering never changes what the caller sees: the wrapper never swallows or wraps an error, never delays a yielded chunk waiting on the sink, and a `sink` failure (e.g. a transient DB error) is caught, logged, and **does not** fail the call — matching "meter … never blocks" (pipeline step 10) even though this task's wrapper sits below the pipeline, not inside its async `meter` step.

### The db adapter (`packages/db/src/repositories/usage-ledger.ts`)

- `usageLedgerRepo(db)` returns `record(scope: StudentScope, row)` and `recordUnmetered(scope: StudentScope, row)`, both taking `packageId` and `turnId` as explicit arguments alongside the scope (mirrors `turnTracesRepo.insert(scope, sessionId, row)`); ownership of `packageId` by the scope's teacher is checked the same `INSERT … SELECT … FROM packages WHERE id = $x AND teacher_id = $t` way package-versions/turn-traces already do (zero rows inserted → `not_found`).
- A small adapter object in `packages/db` (not exported from the repositories barrel's `UsageMeter`-typed slot, but structurally satisfying both `MeterSink` and the frozen `UsageMeter`) wires `record`/`recordUnmetered` onto this repo, so `@edmate/gateway`'s wrapper can be constructed with it by whoever composes them (3.7's wiring, not this task — `@edmate/gateway` gains no new runtime dependency on `@edmate/db`; the composition root imports both).
- Read side: `listForTurn(scope, turnId)`, `sumForStudent(scope)` (or equivalent) — the minimal aggregate needed to show "cost per turn and per active student computed from the rows" per the accept line; full dashboards are 13.5.
- Added to `repositories/README.md`'s isolation-case list and `test/repositories.int.test.ts`'s `CASES` table (this is why the file currently lists "UsageMeter 2.4" as owing its cases here).

### Schema changes (`packages/db/src/schema/`)

- `_shared.ts`: new `pgEnum('entitlement_source', ['subscription', 'teacher_preview', 'eval'])`, checked against the contracts' `Entitlement.source` enum by the existing schema-drift test (1.1's pattern — 9 enums already do this).
- `learning.ts`, `usageLedger` table — additive columns only:
  - `turnId: text('turn_id').notNull()` — a plain column, **not a foreign key**: `meter` and `commit` are both independent async pipeline steps (3.1 decision), so a usage row must not depend on a `turn_traces` row existing yet or ever (a turn can be metered without a trace, e.g. if `commit` fails).
  - `source: entitlementSource('source').notNull()`.
  - `inputTokens`, `outputTokens` made **nullable** (currently `notNull()`); `costMicroUsd` made **nullable**.
  - `status: usageRowStatus('status').notNull().default('recorded')` — new enum `['recorded', 'unknown', 'unpriced']`.
  - `reason: text('reason')` — `null` for `'recorded'`, else `'no_usage_reported'` or `'unpriced_model:<model>'`.
  - Index addition: `(teacher_id, turn_id)` alongside the existing `(teacher_id, package_id, student_id)` index, to support `listForTurn`.
- One new Drizzle migration (`drizzle-kit generate`), additive only (no `DROP`/`ALTER … DROP NOT NULL` is destructive by itself, but relaxing `NOT NULL` and adding nullable/defaulted columns to an as-yet-unused table should apply cleanly to the empty table in every environment so far — the builder double-checks `migrate up/down clean`, 1.1's test pattern).

### Files

**Create**
- `packages/gateway/src/pricing/prices.yaml`, `schema.ts`, `load.ts`, `cost.ts`, `index.ts`.
- `packages/gateway/src/metering/types.ts`, `meteredGateway.ts`, `index.ts`.
- `packages/gateway/test/pricing/*.test.ts`, `packages/gateway/test/metering/*.test.ts`.
- `packages/db/src/repositories/usage-ledger.ts`.
- `packages/db/test/repositories/usage-ledger.int.test.ts` (or added cases in the existing integration test file, per the package's convention — builder checks which).
- One Drizzle migration file under `packages/db/drizzle/` (generated, not hand-written).
- `docs/tasks/2.4/handoff.md` (builder), `docs/tasks/2.4/review.md` (reviewers).

**Modify**
- `packages/gateway/src/index.ts`: export the `pricing` and `metering` barrels.
- `packages/gateway/package.json`: add a pinned YAML-parsing dependency (see Open questions); `@edmate/harness` devDependency already present from 2.3, reused for tests.
- `packages/db/src/schema/_shared.ts`: `entitlementSource`, `usageRowStatus` enums.
- `packages/db/src/schema/learning.ts`: `usageLedger` table columns and index, as above.
- `packages/db/src/repositories/index.ts`: wire in `usageLedgerRepo`.
- `packages/db/src/repositories/README.md`: mark the UsageMeter isolation cases as covered, same way earlier tasks checked off their rows.
- `packages/db/test/repositories/repositories.int.test.ts` (or wherever `CASES`/`scope.test.ts` live): add the new methods.

**Out of bounds**
- `packages/contracts/**` — no change (see Design); no ADR.
- `packages/harness/**` — the pipeline's `meter` step (3.8) and the orchestrator (3.7) are not built yet and are not touched here; this task only builds what they will call.
- Caps: rolling 24-hour message limit, monthly cost alarm — task 2.5, which depends on this task's rows existing.
- Cost dashboard (13.5), teaching-agnostic currency conversion — out of bounds; 13.5 reads these rows later.
- `packages/payments/**`, `ledger_entries`/`payments`/`payouts`/`invoices` tables — a different ledger (money in from students/out to teachers), untouched.
- A composition root that constructs `createMeteredGateway(...)` per real turn with real `ctx` — no task owns the pipeline-wiring layer yet (same gap 2.3 flagged as its Q2); left for 3.7.
- Embeddings (`ModelGateway.embed`) metering with a *real* per-student/package/turn context during document ingestion (2.7/5.1–5.3, no turn exists then) — flagged as an open limitation below, not solved here.
- `.claude/**`, `.github/**`, `.githooks/**`, `docs/adr/**`.

## Tests first (Vitest, TDD — red before green)

All gateway-side tests use fake `ModelAdapter`/`ModelGateway`s or `ScriptedGateway` wrapped the same way 2.3's router tests do — never a real provider call (rule 4). All db-side tests follow 1.2's pattern: unit tests for scope/validation failures run everywhere; the Postgres integration suite runs when `CI=true` or a reachable `TEST_DATABASE_URL` is set, skipped locally otherwise.

1. **`pricing/schema.test.ts` / `cost.test.ts`** (first, no dependencies)
   - Valid `prices.yaml` fixture parses; a negative price, a non-finite price, and an unknown extra key each fail to load, naming the offending model.
   - `computeCostMicroUsd` is exact for a round number and an odd token count (asserted against a hand-computed integer, not `toBeCloseTo`); returns `undefined` for a model absent from the table.
2. **`metering/meteredGateway.test.ts`**
   - A `stream()` call whose fake gateway yields `text*` then `usage` then completes → `sink.record` called once with the real computed cost and the full `ctx`; return value/chunks seen by the caller are byte-identical to what the fake gateway produced.
   - A `stream()` call that yields `usage` then throws (2.2's "stops early" shape) → `sink.record` called once before the `for await` in the test sees the rethrown error; error is unchanged.
   - A `stream()` call that throws with zero chunks yielded → `sink.recordUnmetered({ reason: 'no_usage_reported' })`, no `tokens` field; error unchanged.
   - A `stream()` call that completes with no `usage` chunk at all → same `recordUnmetered('no_usage_reported')`.
   - A `stream()` call whose `usage.model` isn't in the test's price table → `sink.recordUnmetered({ reason: 'unpriced_model:<model>', tokens: {...} })`; a log spy sees exactly one line naming the model, no student text.
   - Same three-way matrix repeated for `generateObject()` and `embed()`.
   - `sink.record`/`recordUnmetered` throwing (simulated DB failure) does not change the wrapper's returned/yielded value or thrown error — asserted by making the fake sink always reject and checking the caller-visible outcome is untouched.
   - An early `break` out of the `for await` loop over `stream()`'s result still triggers exactly one `sink.record`/`recordUnmetered` call (whichever applies to what was seen before the break).
   - `ctx.source` round-trips for all three `Entitlement['source']` values.
3. **`packages/db/src/repositories/usage-ledger.ts` unit tests**: bad scope (missing/extra field) throws `RepositoryError('scope')` before any SQL, for every method, same as every other repository's `scope.test.ts` entry.
4. **`usage-ledger.int.test.ts`** (Postgres, `CI=true` or local Docker)
   - `record` with a valid scope and an owned `packageId` inserts one row with `status: 'recorded'` and the right `teacherId/packageId/studentId/turnId/source/model/tier/tokens/cost`.
   - `record`/`recordUnmetered` with a `packageId` belonging to another teacher throws `not_found`; the row count is unchanged.
   - `recordUnmetered({ reason: 'no_usage_reported' })` inserts a row with `inputTokens/outputTokens/costMicroUsd: null`, `status: 'unknown'`.
   - `recordUnmetered({ reason: 'unpriced_model:x', tokens })` inserts a row with real tokens, `costMicroUsd: null`, `status: 'unpriced'`, `reason` containing `'x'`.
   - A read scoped to teacher/student A never returns teacher/student B's rows (seeded two-teacher, two-student grid, 1.2's isolation pattern).
   - `listForTurn`/`sumForStudent` over a small seeded set return the expected sums, including when some seeded rows are `'unknown'`/`'unpriced'` (their cost contributes `0`, not `null`, to a sum — but the row itself is never mistaken for "this turn cost nothing" by a caller that also checks `status`).
   - Isolation added to the shared `CASES` grid so `tsc` fails if a new method has no case (1.2's compile-time guard).

Implementation order: pricing (no dependencies) → metering wrapper against fake gateways/sinks (no real db) → db schema + migration → `usage-ledger` repo unit tests (scope validation) → `usage-ledger` integration tests (real Postgres) → wire `usageLedgerRepo` into `createRepositories`.

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --filter=@edmate/db...`.

## Risky paths touched

Checked every planned path (including the new `pricing/`, `metering/` and `usage-ledger.ts` files, the schema edits and the migration) against `.claude/skills/merge-gate/risk-paths.txt`:

- `packages/db/src/repositories/**` — **matched.** Group: "The access filter … money … keeping each teacher's and student's data apart." **Reviewers required: security-reviewer.** This task adds `usage-ledger.ts` and edits `index.ts` in that folder, so the branch is risky and needs a `risk: high` decision entry in the handoff (per the merge gate: a risky branch needs its required reviewers named in `review.md`'s `Reviewers:` line and a `risk: high` decision in the handoff, or the gate fails it).
- `packages/db/src/schema/**` — not listed as a risk-paths.txt glob on its own; still worth a database-reviewer's eyes given the enum/column/migration changes (not required by the gate, but recommended — the lead decides whether to add one).
- `packages/gateway/src/pricing/**`, `packages/gateway/src/metering/**`, `packages/gateway/src/index.ts` — not listed (only `packages/gateway/src/keys/**` is risky under `gateway`).
- `packages/contracts/**`, `docs/adr/**` — untouched; no contracts change.
- `packages/harness/**`, `content/**`, `evals/suites/**`, `apps/worker/src/alerts/**`, `packages/payments/**`, `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**` — untouched.
- `.claude/**`, `.github/**`, `.githooks/**` — untouched.

**Risky: `packages/db/src/repositories/**` → security-reviewer required; plan a `risk: high` decision entry in the handoff** (e.g. "money/metering data stored per teacher and student, scoped the same way as every other repository"). Database-reviewer recommended but not gate-required for the schema/migration edits.

## Open questions (lead can decide; none blocks the build)

- **Q1. "Unpriced model" → flagged row, loud log, or both?** Recommendation: both — a flagged row (`status: 'unpriced'`, real tokens kept, `costMicroUsd: null`) so no call is ever silently dropped from the ledger, **and** one loud log line (model id only, no student data) so an ops person notices a model is running with no price before the next cost review. Never a thrown error from the wrapper itself (that would make a pricing gap take down live turns), and never a silent `0`.
- **Q2. Exact YAML dependency and pin.** No package in the repo parses YAML in Node yet (only Python tooling does). Recommendation: add `yaml` (the actively maintained, dependency-free parser) to `packages/gateway/package.json` as a runtime dependency, pinned to its current stable version exactly, following the repo's exact-pin convention; the builder confirms the current version at build time (same as 2.2's AI SDK pins).
- **Q3. Bundling `prices.yaml` into the built package.** `tsc` doesn't copy non-`.ts` files into `dist/`. Recommendation: add a one-line copy step to `packages/gateway`'s `build` script (`tsc -p tsconfig.build.json && cp -r src/pricing/prices.yaml dist/pricing/`, or equivalent), and have `load.ts` resolve the file relative to its own compiled location (`import.meta.url`) so it works identically from `src` (ts-node/vitest) and `dist` (built). First instance of this pattern in the repo; flagging so the lead can confirm rather than the builder guessing a convention.
- **Q4. `embed()` metering with no real per-student/turn context (ingestion time).** The wrapper is generic enough to meter `embed()` too, but `ctx` (teacherId, packageId, **studentId, turnId**) doesn't naturally exist during document ingestion (2.7/5.1–5.3) — there is no student or turn. Recommendation: this task ships the generic wrapper only; whichever task wires `embed()` calls for ingestion (not yet built) decides what `ctx` to pass (e.g. a teacher-only ingestion sentinel, or a separate, differently-shaped ingestion-cost sink outside `UsageMeter` entirely) — flagged rather than guessed, since inventing a fake `studentId`/`turnId` now would risk polluting the per-student dashboards (13.5) this task's rows are meant to feed.
- **Q5. Should `turnTraces` also gain `turn_id`/`source` now, since it's the same gap pattern?** No — out of bounds. `turn_traces.turnId` is explicitly deferred to the `TraceSink` owner (3.8/7.7) per the existing code comment in `turn-traces.ts`; this task only fixes the gap in `usage_ledger`, which it is explicitly responsible for.

## Lead answers

Pending.

## Lead answers (18 Oct 2026)

- Q1: flagged row + loud log, both. Q3: bundle prices.yaml into dist. Q4: defer embed metering context to the ingestion task. Q5: out of bounds (3.8/7.7).
- Q2: YAML is already used by packages/evals (task 3.12) — reuse the same `yaml` package at the exact same pinned version; don't add a second YAML library.
- Usage with no counts from the provider is recorded as unknown, never as zero cost.
- Reviewers: security-reviewer, database-reviewer, typescript-reviewer; handoff needs a risk: high entry.
- Before your final push: merge origin/main, regenerate the lockfile if it conflicts, re-run gates. Task 1.6 builds in packages/db in parallel (audit log): coordinate by touching only usage-ledger files and the repositories index; if the index conflicts at merge, resolve by keeping both exports.
