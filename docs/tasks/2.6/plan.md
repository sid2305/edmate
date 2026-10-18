# Task 2.6: Scripted gateway in `harness/testing`

Board: `python3 .claude/skills/board/board.py show 2.6` · Milestone M2 · deps: M0 · branch `m2/2.6-scripted-gateway` · risk: none found.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Scripted gateway in `harness/testing`"
Accept: "replays fixtures deterministically, including tool calls and usage."

Spec it must honour:
- Build plan § Turn pipeline spec, Determinism: "every step accepts an injected clock, id generator and gateway; `harness/testing` ships a scripted gateway that replays fixtures."
- Build plan § Repo layout: "Tests use in-memory adapters from `harness/testing`" ("harness/testing fixtures re-export from 0.3").
- Build plan § Model gateway: routing has small/main tiers and a fallback on 5xx/timeout/rate limit (2.3 needs a scriptable provider error for this); metering needs usage per call (2.4/2.5); the orchestrator (3.7) streams tool calls.
- ADR-0002: ports (`ModelGateway` among them) live in `packages/contracts/src/ports.ts`, type-only; adapters implement them by importing contracts; "the scripted gateway that replays fixtures" is named as a `harness/testing` adapter.
- Rule 3 (harness purity): `packages/harness` imports only `@edmate/contracts`, `zod`, `mathjs` and its own modules.
- Rule 4: no real model calls in tests; use the scripted gateway and fixtures.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Determinism | A test runs the same `GatewayScript` through two fresh `ScriptedGateway` instances and asserts byte-identical chunk sequences, in order. |
| Tool calls replay | A script step of `{ type: 'tool_call', id, name, args }` (the real `ModelChunk` variant) comes out of `stream()` unchanged, including `args`. |
| Usage replays | A script step of `{ type: 'usage', usage }` comes out of `stream()` unchanged; `generateObject`/`embed` scripts can attach usage the same way for 2.4's metering tests. |
| Clear failure: no match | Calling `stream()`/`generateObject()`/`embed()` past the end of its queue, or with a request no predicate matches, throws `ScriptedGatewayError` naming the method, the call index and (for a predicate miss) a redacted snapshot of the request — never a silent empty stream. |
| No real timers | A script step `{ type: 'delay', ms: 5000 }` is honoured via the injected `Clock.sleep`, not `setTimeout`; the test using a manual fake clock completes in well under 5000 ms of wall time. |
| Coverage | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` green; coverage report for `src/testing/**` at the package's existing threshold (80%) or better. |
| Purity | `eslint .` in `packages/harness` passes (the harness-purity rule); no new dependency added. |

## Design

### What exists already
- `ModelGateway` (contracts `ports.ts`): `stream(req): AsyncIterable<ModelChunk>`, `generateObject<T>(req, schema): Promise<T>`, `embed(texts): Promise<number[][]>`.
- `ModelChunk` (contracts `model.ts`, Zod discriminated union): `text`, `tool_call` (`id`, `name`, `args`), `usage` (`usage: Usage`). Usage is already a chunk variant — no new type needed to satisfy "including tool calls and usage".
- `packages/harness/src/testing/index.ts` currently only re-exports `@edmate/contracts/fixtures`. This task adds the gateway and its own fixtures alongside that re-export.
- No `Clock` or id-generator port exists yet in contracts (the pipeline runner that needs one platform-wide is task 3.1, not built). 2.6 must not wait on that.

### `ScriptedGateway` (`src/testing/scriptedGateway.ts`)
Implements `ModelGateway` from contracts. Constructed with a `GatewayScript` and a `Clock`:

```ts
interface Clock { sleep(ms: number): Promise<void> }
```

Minimal and local to `harness/testing` (its own module — allowed by rule 3). Not added to `packages/contracts/src/ports.ts`: that file is the ADR-0002 port list, and adding to it is a contracts change needing an ADR (rule 2) for a type this task only needs internally. See Open question Q1 on reconciling with 3.1 later.

Script shape — one independent, ordered queue per method (not one global call counter), because the turn pipeline spec runs steps 3, 4 and retrieval concurrently: two small-tier `stream()` calls can race, so matching must not assume a single call order across methods:

```ts
type StreamStep =
  | ModelChunk                                   // text | tool_call | usage (replayed as-is)
  | { type: 'delay'; ms: number }                 // waits on the injected Clock, not a real timer
  | { type: 'error'; code: ErrorCode; message?: string }; // thrown from the async generator

interface ScriptedStreamCall {
  match?: (req: ModelRequest) => boolean;         // omit for plain call-index matching
  steps: StreamStep[];
}
interface ScriptedObjectCall<T = unknown> {
  match?: (req: ModelRequest) => boolean;
  value: T;                                       // parsed with the caller's schema before returning
}
interface ScriptedEmbedCall {
  match?: (texts: string[]) => boolean;
  vectors: number[][];
}
interface GatewayScript {
  stream?: ScriptedStreamCall[];
  generateObject?: ScriptedObjectCall[];
  embed?: ScriptedEmbedCall[];
}
```

Matching, per method, on each call: scan the method's still-unconsumed entries in script order; the first entry whose `match` returns `true` wins (entries with no `match` are treated as matching only when it is their turn — i.e. no earlier entry remains that also lacks a predicate and is unconsumed — so an all-index script behaves exactly like a simple ordered queue, and a script that mixes predicates with plain entries still resolves deterministically). On a match, mark the entry consumed; `ScriptedGateway` never reuses an entry. On no match — queue empty, or every remaining entry's predicate returned `false` — throw `ScriptedGatewayError` with the method name, the 0-based call index for that method, and (for a predicate miss) `{ tier, system: req.system.slice(0, 80), messageCount: req.messages.length }`, never the full request (keeps the repo's "no real student data in fixtures/logs" posture even for synthetic test data).

`stream()` returns an async generator that, for each `StreamStep` in the matched entry's `steps` in order: a `ModelChunk` is `yield`ed; `{ type: 'delay' }` calls `await clock.sleep(ms)` and yields nothing; `{ type: 'error' }` throws (ending the stream) after any prior steps have already been yielded, so a script can test "two chunks then a provider error mid-stream" for 2.3's fallback case later.

`generateObject(req, schema)` finds the matched entry and returns `schema.parse(entry.value)` — validated, not just cast — so an author of a bad fixture gets a Zod error pointing at the fixture, not a silent type mismatch surfacing in a caller's test months later.

`embed(texts)` finds the matched entry (predicate over `texts`, or index) and returns `entry.vectors`.

### Fixture location: `harness/testing`, not `evals/fixtures/`
Chosen because:
1. **Harness purity.** `packages/harness` may import only `@edmate/contracts`, `zod`, `mathjs` and its own modules (rule 3; enforced by the `harness-purity` ESLint rule, which disallows Node builtins including `node:fs`). Loading JSON files at runtime would need `fs` or an import-assertion loader; TypeScript data modules exported as plain objects (the pattern `packages/contracts/fixtures` already uses, re-exported by `harness/testing` since 0.3) need neither and are type-checked.
2. **Different consumers, different lifecycles.** The repo layout lists `evals/fixtures/` as "recorded model responses for offline CI" for the **eval runner's** `--record`/replay (task 3.12: live provider responses and judge outputs, captured from real runs). 2.6's scripts are hand-authored test doubles for the harness's own unit and integration tests (pipeline steps 3.1, orchestrator 3.7, router fallback 2.3) and exist before any live run has happened. Keeping them separate means a change to one doesn't move the other's goalposts.
3. ADR-0002 already names "the scripted gateway that replays fixtures" as living in `harness/testing`.

If 3.12 later wants to turn a recorded live fixture into a `GatewayScript` for a harness-level test, it converts the recording into one of these TS data modules rather than the harness loading `evals/fixtures/` files directly (which would violate purity in any case, since `evals` is a separate package outside the allow-list).

### Demo scripts (`src/testing/gatewayFixtures.ts`)
Exported, reusable building blocks for later tasks (2.3's fallback test, 3.1's pipeline tests, 3.7's streaming integration test), mirroring the naming style of `contracts/fixtures`:
- `scriptedStreamText` — a two-chunk reply (`text`, `text`) then `usage`.
- `scriptedStreamToolCall` — `tool_call` (reusing `modelChunkToolCall` from contracts fixtures) then `text` then `usage`.
- `scriptedStreamWithDelay` — `text`, `{ type: 'delay', ms: 1500 }`, `text`, `usage` (for latency-shaped tests without a real wait).
- `scriptedStreamProviderError` — `text`, then `{ type: 'error', code: 'provider_error' }` (for 2.3's "a simulated 5xx fails over within one retry").
- `scriptedObjectIntent` / `scriptedEmbedPair` — minimal `generateObject`/`embed` examples.

### `src/testing/clock.ts`
- `type Clock = { sleep(ms: number): Promise<void> }`.
- `manualClock()`: a `Clock` whose `sleep` resolves immediately (default) but records every requested `ms` in an inspectable array, so a test can assert "a 1500 ms delay was requested" without waiting 1500 ms. This is the fake used by the scripted-gateway's own tests and offered to later tasks (3.1, 3.7) as the default test clock. No real timer (`setTimeout`/`setInterval`) appears anywhere in `src/testing/`.

## Files

### Create
- `packages/harness/src/testing/clock.ts`, `clock.test.ts`
- `packages/harness/src/testing/scriptedGateway.ts`, `scriptedGateway.test.ts`
- `packages/harness/src/testing/gatewayFixtures.ts` (demo scripts above; no `.test.ts` of its own — exercised through `scriptedGateway.test.ts` and `fixtures.test.ts`)
- `docs/tasks/2.6/handoff.md` (builder), `docs/tasks/2.6/review.md` (reviewers)

### Modify
- `packages/harness/src/testing/index.ts`: keep the existing `export * from '@edmate/contracts/fixtures'`; add exports for `ScriptedGateway`, `ScriptedGatewayError`, the script types, `manualClock`, `Clock`, and the demo scripts.
- `packages/harness/src/testing/fixtures.test.ts`: add one `describe` block asserting the new exports exist and that the demo scripts' `ModelChunk` steps parse against `schemas.ModelChunk` (reuses the existing `Parser` shape already in that file) — keeps the new fixtures honest against the real schema, the same discipline `contracts/fixtures` already applies to itself.

No change expected to `packages/harness/package.json` (no new dependency: `zod` is already there, `ModelRequest`/`ModelChunk`/`ErrorCode` types come from `@edmate/contracts`), `tsconfig*.json`, `vitest.config.ts`, or `pnpm-lock.yaml`.

### Out of bounds
- Real provider adapters and capability declarations (`packages/gateway/**`, task 2.2).
- `packages/contracts/**` (no schema change; the local `Clock` type is deliberately kept out of `ports.ts` — see Open question Q1). Any contracts change here would need an ADR and is not asked for by this task's acceptance line.
- `packages/harness/src/pipeline/**` (task 3.1 — the pipeline runner that will consume this gateway doesn't exist yet).
- Router/fallback logic (`packages/harness` routing, 2.3), metering (2.4), limits (2.5) — this task only has to make a provider-error step scriptable for them to use later.
- `evals/**`, `packages/evals/**`, `evals/fixtures/**` (3.12's recorded-fixture format and `--record` flow).
- `.claude/**`, `.githooks/**`, `.github/**`, `docs/adr/**`.

## Tests first (Vitest, TDD — red before green)

1. **`clock.test.ts`** (write first; no dependency on the gateway)
   - `manualClock().sleep(ms)` resolves without a real wait (test completes near-instantly even for `ms: 10_000`, asserted by wall-clock budget, not `vi.useFakeTimers`).
   - Every requested `ms` is recorded, in call order.
2. **`scriptedGateway.test.ts`**
   - **Determinism:** build the same `GatewayScript`, run it through two separate `ScriptedGateway` instances, collect `stream()` output (via `for await`) for each, and assert the arrays are deep-equal and in the same order.
   - **Text + usage replay:** a script with `[text, text, usage]` yields exactly those three chunks, unchanged, via `stream()`.
   - **Tool call replay:** a script step reusing contracts' `modelChunkToolCall` fixture comes out with `id`, `name` and `args` intact.
   - **Delay, no real timer:** a script with a `{ type: 'delay', ms: 5000 }` step, run with `manualClock()`, completes the test in well under 5000 ms; `manualClock().sleeps` recorded `[5000]`.
   - **Error step:** a script with `[text, { type: 'error', code: 'provider_error' }]` yields the one `text` chunk then the `for await` loop throws an error identifiable as `provider_error`.
   - **Index-based matching:** two `stream()` calls in sequence with no `match` predicates consume the two script entries in order.
   - **Predicate-based matching under concurrency:** two scripted entries with `match` on `req.tier`; call `stream()` for `'main'` and `'small'` via `Promise.all` in reversed script order and assert each gets its own entry (proves matching isn't order-dependent when predicates are used, matching the pipeline's concurrent steps 3/4).
   - **Exhausted queue:** a third `stream()` call past two scripted entries throws `ScriptedGatewayError` naming the method and call index 2.
   - **No predicate match:** a request that matches no entry's predicate throws `ScriptedGatewayError` with the redacted request snapshot, not a silent fallback or an empty stream.
   - **`generateObject`:** a scripted value that fails the caller's Zod schema throws a Zod error from `schema.parse`, not a cast; a valid value round-trips.
   - **`embed`:** returns the scripted vectors for the matching call.
3. **`fixtures.test.ts`** (extend): the new demo-script exports exist and their `ModelChunk`-shaped steps parse against `schemas.ModelChunk`.

Implementation order: `clock.ts` after its test is red; then `scriptedGateway.ts`'s types and the index-based happy path; then error/exhaustion handling; then predicate matching; then `gatewayFixtures.ts`; then wire `src/testing/index.ts` and extend `fixtures.test.ts` last.

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`.

## Risky paths touched

Checked every planned path (including the new files) against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/harness/src/testing/**` — not listed (only `packages/harness/src/guardrails/**` and `packages/harness/src/access/**` are risky under `harness`).
- `packages/contracts/**`, `docs/adr/**` — untouched.
- `.claude/**`, `.github/**`, `.githooks/**` — untouched.
- `packages/payments/**`, `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `packages/gateway/src/keys/**`, `packages/db/src/repositories/**` — untouched.
- `content/prompt-packs/**`, `content/skills/**`, `content/locales/**`, `evals/suites/safety/**`, `evals/suites/locked/**`, `apps/worker/src/alerts/**` — untouched.

**None (checked against risk-paths.txt).** No `risk: high` decision entry is planned.

## Decisions (to copy into the handoff `## Decisions`)

### 2.6 Fixture format and location · decided by planner · risk: low
Decided: scripts are hand-authored TypeScript data modules in `packages/harness/src/testing/`, typed against the contracts `ModelChunk`/`ModelRequest` types, not JSON files or `evals/fixtures/`.
Why: harness purity (rule 3) rules out runtime file loading without `fs`; `evals/fixtures/` is reserved for 3.12's recorded live/judge responses, a different lifecycle.
Alternatives: JSON fixtures loaded by path; sharing one fixtures directory with the eval runner.
Reversible: yes — a later task can add a converter from a recorded JSON fixture to this script shape.

### 2.6 `Clock` kept local to `harness/testing`, not added to contracts ports · decided by planner · risk: low
Decided: `Clock` (`{ sleep(ms): Promise<void> }`) is defined in `packages/harness/src/testing/clock.ts`, not in `packages/contracts/src/ports.ts`.
Why: it's an internal test-double detail of the scripted gateway; adding it to contracts now would be a contracts change needing an ADR (rule 2) before the pipeline runner (3.1) — the task that actually needs a platform-wide injected clock — has said what shape it needs (it may also want `now()` and an id generator together).
Alternatives: add a `Clock` port to contracts now, pre-empting 3.1.
Reversible: yes — 3.1 can promote/align it by ADR once its own needs are known.

### 2.6 Matching: predicate-first per method, index fallback · decided by planner · risk: low
Decided: each `ModelGateway` method (`stream`, `generateObject`, `embed`) has its own ordered queue; a call is matched to the first unconsumed entry whose `match` predicate returns true, or (for entries with no predicate) by queue order.
Why: the turn pipeline spec runs steps 3, 4 and retrieval concurrently, so two `stream()` calls can race; a single global call-index would make tests flaky or order-dependent.
Alternatives: one global counter across all methods; index-only matching (no predicates).
Reversible: yes.

## Open questions (lead can decide; none blocks the build)

- **Q1. Should `Clock` move into `packages/contracts/src/ports.ts` now instead of staying local to `harness/testing`?** Recommendation: no — keep it local for 2.6; let 3.1 (the pipeline runner, which the build plan says needs "injected clock, id generator and gateway") define the shared shape and promote it by ADR if the two should be the same type. Keeps 2.6 contracts-free and avoids a premature ADR.
- **Q2. Should `generateObject`'s scripted value be validated with `schema.parse` (fail loud on a bad fixture) or passed through as-is?** Recommendation: `parse` — catches a malformed fixture at the point it's defined, consistent with how `contracts/fixtures` already round-trips every fixture through its own schema.
- **Q3. One global call counter vs. per-method queues?** Recommendation: per-method queues (reasoning above), because steps 3/4 of the turn pipeline run concurrently.

None of these are open spec decisions (`docs/board/tasks.yaml` `decisions:` block) and none change a frozen contract; they're implementation choices the planner is making directly, logged above for the handoff.

## Lead answers (18 Oct 2026)

- Q1: Clock stays local to harness/testing for now (no contracts change, no ADR); revisit in 3.1 if the pipeline needs it as a port.
- Q2: generateObject validates the scripted value with `schema.parse`.
- Q3: per-method queues, predicate-first then index fallback.
- Task 2.2 builds in packages/gateway in parallel; stay in packages/harness/src/testing.
