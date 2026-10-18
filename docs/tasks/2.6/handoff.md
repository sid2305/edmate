# 2.6 handoff: scripted gateway in `harness/testing`

Status: DONE
Branch: `m2/2.6-scripted-gateway`
Worktree: `.claude/worktrees/agent-af3ef95ef81d26ca1`
Risky: no (only `packages/harness/src/testing/**` and `docs/tasks/2.6/`; checked against `risk-paths.txt`).

## Acceptance evidence

Acceptance: "replays fixtures deterministically, including tool calls and usage."

| Item | Evidence |
|---|---|
| Determinism | `is deterministic: the same script through two instances gives identical chunks`: two fresh `ScriptedGateway`s, same script, `JSON.stringify` of the chunk sequences is identical and in order. |
| Tool calls replay | `replays tool calls with id, name and args intact` (contracts `modelChunkToolCall`). |
| Usage replays | `replays text and usage chunks unchanged`; `records usage per call, from attached usage and stream usage chunks` (`generateObject`/`embed` entries take an optional `usage`, exposed with stream usage chunks on `gateway.usage`). |
| Clear failure: no match | `throws ScriptedGatewayError naming the method and index when the queue is exhausted` (call 2); `throws with a redacted request snapshot when no predicate matches` (`{ tier, system: first 80 chars, messageCount }`, message contents absent); same for `generateObject` and `embed` (`{ textCount }` only). |
| No real timers | `honours delay steps through the injected clock, not a real timer`: a 5000 ms delay step finishes in under 1000 ms of wall time, and `manualClock().sleeps` is `[5000]`. There's no `setTimeout`/`setInterval` in `src/testing/`. |
| Coverage | 100% statements, branches, functions and lines for `src/testing/**` (threshold 80%). |
| Purity | `eslint .` passes in `packages/harness`. Imports are only `@edmate/contracts`, `@edmate/contracts/fixtures`, `zod` (type-only) and relative modules. No new dependency, and `package.json` and the lockfile are unchanged. |

`corepack pnpm turbo run build typecheck lint test --filter=@edmate/harness...`
```
@edmate/config:test:      Tests  34 passed (34)
@edmate/contracts:test:   Tests  282 passed (282)
@edmate/harness:test:     Tests  65 passed (65)
@edmate/harness:test: All files          |     100 |      100 |     100 |     100 |
@edmate/harness:test:  src/testing       |     100 |      100 |     100 |     100 |
 Tasks:    11 successful, 11 total
```

`vitest run --reporter=verbose src/testing/scriptedGateway.test.ts` → 22 passed. These include the ones in the table, plus: the error step yields earlier chunks and then throws `ScriptedProviderError` with the code; a scripted error message; plain entries run in order; predicate matching under `Promise.all`; mixed predicate and plain entries; the match is fixed when `stream()` is called, not at iteration; a script with no `stream` key; a later change to the script doesn't change the replay; non-plain args are kept; Zod rejects a bad `generateObject` value.

Root gates:
- `corepack pnpm turbo run build typecheck lint test` → `Tasks: 39 successful, 39 total`.
- `python3 .githooks/secret-scan.py --all` → exit 0, no output.
- `corepack pnpm format:check`: all files on this branch are clean. It still flags `.github/workflows/ci.yml`, which is already unformatted on main and outside this task.

## Changes

- `packages/harness/src/testing/clock.ts` (+ test): `Clock { sleep(ms) }` and `manualClock()` (resolves at once and records `sleeps`).
- `packages/harness/src/testing/scriptedGateway.ts` (+ test): `ScriptedGateway implements ModelGateway`, `ScriptedGatewayError`, `ScriptedProviderError`, script types.
- `packages/harness/src/testing/gatewayFixtures.ts`: `scriptedStreamText`, `scriptedStreamToolCall`, `scriptedStreamWithDelay`, `scriptedStreamProviderError`, `scriptedObjectIntent`, `scriptedEmbedPair`.
- `packages/harness/src/testing/index.ts`: exports all of the above, still re-exporting the contracts fixtures.
- `packages/harness/src/testing/fixtures.test.ts`: new block checking the exports, and that the demo chunks and usage parse against `schemas.ModelChunk`/`schemas.Usage`.

## Deviations

- Additions the plan didn't name (all additive, for 2.3/2.4): `ScriptedProviderError` (with an `ErrorCode` `code`) for error steps, an optional `usage` on `generateObject`/`embed` entries, and a `gateway.usage` record.
- Script data is copied with a small local plain-data copy, not `structuredClone`. The harness tsconfig has no DOM/Node lib types, so `structuredClone` doesn't typecheck. Tests use `Date.now()` instead of `performance.now()` for the same reason.

## Decisions

### 18 Oct 2026 · 2.6 Fixture format and location · decided by planner · risk: low
Decided: Scripts are hand-written TypeScript data modules in `packages/harness/src/testing/`, typed against the contracts `ModelChunk`/`ModelRequest`. They are not JSON files and not in `evals/fixtures/`.
Why: Harness purity rules out loading files at runtime. `evals/fixtures/` is for 3.12's recorded live responses, which have a different lifecycle.
Alternatives: JSON fixtures loaded by path; one fixtures directory shared with the eval runner.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Clock kept local to harness/testing · decided by lead · risk: low
Decided: `Clock` (`{ sleep(ms): Promise<void> }`) lives in `packages/harness/src/testing/clock.ts`, not in contracts `ports.ts`.
Why: Only the test double needs it now. Task 3.1 should define the platform-wide clock/id shape and promote it by ADR if needed.
Alternatives: Add a `Clock` port to contracts now.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Matching per method, predicate first then order · decided by lead · risk: low
Decided: Each method has its own queue. A call takes the first unused entry whose `match` returns true (in script order). If none matches, it takes the first unused entry without a predicate. Entries are never reused. The `stream()` entry is picked when `stream()` is called, not when it is first iterated.
Why: Pipeline steps 3, 4 and retrieval run concurrently, so one global call order would make tests flaky.
Alternatives: One global counter; matching by order only; picking at first iteration.
Reversible: Yes.

### 18 Oct 2026 · 2.6 How a missing script entry fails · decided by builder · risk: low
Decided: `stream()` with no matching entry throws `ScriptedGatewayError` on the first iteration, the same way a provider failure would surface. `generateObject`/`embed` reject. The error names the method and the 0-based call index for that method. On a predicate miss it adds a redacted snapshot (`tier`, the first 80 chars of `system`, `messageCount`; for `embed`, `textCount` only).
Why: Callers such as the 2.3 router only need to handle errors in one place, during iteration. The snapshot never carries message text.
Alternatives: Throw synchronously from `stream()`; return an empty stream.
Reversible: Yes.

### 18 Oct 2026 · 2.6 generateObject validates with the caller's schema · decided by lead · risk: low
Decided: `generateObject` returns `schema.parse(value)`, so a bad fixture throws a Zod error.
Why: A malformed fixture fails where it is defined, not later in a caller's test.
Alternatives: Pass the value through with a cast.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Scripted provider errors and usage record · decided by builder · risk: low
Decided: A `{ type: 'error', code, message? }` step throws `ScriptedProviderError` carrying a contracts `ErrorCode`. `generateObject`/`embed` entries take an optional `usage`. The gateway exposes `usage`, a list of `{ method, usage }` in replay order that includes stream `usage` chunks.
Why: 2.3 needs a provider error it can recognise, and 2.4 needs usage from every call type, not only streams.
Alternatives: Throw a plain `Error`; leave usage on non-stream calls to later tasks.
Reversible: Yes.
