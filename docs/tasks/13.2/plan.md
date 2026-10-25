# 13.2 plan — load test: 50 concurrent students

Status: READY (lead-written, 25 Oct 2026)
Budget: 35 tool calls (1 phase, package @edmate/harness + docs/try-it.md).

## Goal
Board 13.2. Accept: "harness overhead p95 < 500 ms with the scripted gateway." (`docs/board/tasks.yaml`
id 13.2; build plan line 351 names this the same target the turn-pipeline spec already promises.)

The narrowest entry point that still counts as "the harness" is `runTurn` wired with the **real**
step set (`defaultSteps` from `packages/harness/src/pipeline/steps/index.ts` — the same set
`apps/web/src/turn/runtime.ts` passes to production) over in-memory ports and the scripted gateway,
not the HTTP chat route. `packages/harness/src/pipeline/turn.integration.test.ts`'s `world()`
helper already builds exactly this kind of world (real `admit`/`entitle`/`buildContext`/`decide`/
`generate`, in-memory `EntitlementStore`/`TurnConfigStore`/`RetrievalIndex`/profiles/transcripts,
`ScriptedGateway` + `spyGateway`); this task copies that pattern 50× with every step real
(`defaultSteps`, so `preGuard`/`route`/`postGuard`/`meter`/`commit` are real too) and a **real**
clock instead of the deterministic virtual one, because we need genuine wall-clock concurrency, not
stepped time.

`packages/harness/src/testing/testDeps.ts`'s `judge: 'grounded'` option already answers grounding's
per-reply judge call outside the script (no model call, no new script steps to write); the default
advice judge (`markerJudge`) is already rule-based with no model call. So the only scripted model
call per turn is `generate`'s one streamed reply, plus one `{ type: 'delay', ms: 150 }` step that
stands in for the model's own latency. Per turn: `overheadMs = wallMs - 150`, where `wallMs` is
measured with a real clock (`Date.now()`) around `runTurn` + `driveTurn`, not the virtual one — the
150 ms is known from the script, never measured, so it cancels out exactly.

## Needs Postgres or Redis
No. Every port (entitlements, turnConfig, retrieval, profiles, transcripts, teacherQuestions,
usage, traces, alerts, safetyEvents) is an in-memory fixture, the same pattern
`turn.integration.test.ts`'s `world()` already uses. No `TEST_DATABASE_URL`, no containers.

## Runs in CI?
No — opt-in only, run on demand. Lessons.md: "Wall-clock bounds fail on shared CI runners... count
operations instead." A 50-way wall-clock assertion must never gate a shared CI runner. The file
lives outside both gates on purpose:
- `packages/harness/scripts/` is outside `tsconfig.json`'s `"include": ["src"]`, so
  `turbo run typecheck --filter=@edmate/harness` never looks at it (same reason
  `packages/db/scripts/record-demo-embeddings.ts` sits outside `packages/db`'s normal path, though
  db's tsconfig does include `scripts`; harness's does not, and this plan does not touch
  `packages/harness/tsconfig.json` — adding `"node"` types there would weaken the purity boundary
  the ADR already drew, so leave it alone).
- `vitest.config.ts`'s `include: ['src/**/*.test.ts']` never picks it up either (the file is not
  named `*.test.ts` and lives outside `src/`).
- ESLint still lints it fine (`@edmate/config/eslint/base.js` sets `globals: { ...globals.node }`
  for every file and uses `tseslint.configs.recommended`, not the type-checked variant, so a file
  outside the tsconfig `include` still lints without a parser-project error).
- Invoked directly: `node packages/harness/scripts/loadTest50.ts` (Node's native TS run, same
  convention as `record-demo-embeddings.ts`; relative imports inside the script use explicit `.ts`
  extensions, not `.js`, for the same reason that script does).

## Changes
1. **`packages/harness/src/testing/percentiles.ts`** (new, small, pure). `percentile(sorted:
   readonly number[], p: number): number` (nearest-rank; throws on an empty array). This is the one
   piece of new logic that is deterministic and belongs in the normal, CI-gated test suite.
2. **`packages/harness/src/testing/percentiles.test.ts`** (new). Fixed arrays only (e.g. `[1..100]`
   → p50/p95/p99 known values; a single-element array; the empty-array throw). No timing, no clock.
3. **`packages/harness/scripts/loadTest50.ts`** (new). Builds 50 independent "worlds" (own
   `memoryTranscriptStore`, own in-memory `EntitlementStore`/`TurnConfigStore`/`RetrievalIndex`/
   profiles per student id `load-test-student-<i>`, own `ScriptedGateway` wrapped in `spyGateway`),
   each via `testDeps({ clock: wallClock(), judge: 'grounded', overrides: {...} })` and
   `defaultSteps` (not `testSteps`'s doubles). `wallClock()` is a small local function (not exported,
   not added to `src/testing/`) that satisfies the `VirtualClock` shape `testDeps`/`driveTurn`
   expect, but backed by real `Date.now()`/`setTimeout`, with `drive(promise)` simply returning
   `promise` (nothing needs manual firing: the script has no sleeps other than the gateway's own
   scripted `delay` step, which already resolves on a real timer). Runs all 50 turns concurrently
   with `Promise.all`, times each with `Date.now()` around `runTurn` + `driveTurn`, subtracts the
   known 150 ms scripted delay, collects 50 `overheadMs` samples, prints p50/p95/p99 via
   `percentile()`, and sets `process.exitCode = 1` when p95 >= 500.
4. **`packages/harness/package.json`**: add `"load-test:50": "node scripts/loadTest50.ts"` to
   `scripts` (not added to `build`/`typecheck`/`lint`/`test`, so `turbo run typecheck lint test`
   never runs it).
5. **`docs/try-it.md`**: one new short section, "## 9. Optional: load test (50 concurrent
   students)", after "## 8. Optional: the automated run" and before "## Troubleshooting". States
   that it needs no running stack (no Docker, no Postgres), what command to run
   (`corepack pnpm turbo run build --filter=@edmate/contracts...` once, then
   `node packages/harness/scripts/loadTest50.ts`), and how to read the p50/p95/p99 line.

## Tests first
- `percentiles.test.ts` first (step 2), red then green, before `loadTest50.ts` is written — it is
  the one piece of this task with normal, deterministic TDD coverage.
- `loadTest50.ts` itself is proven by running it, not by a vitest assertion (the lessons.md
  wall-clock entry above). Before writing the handoff: run it once standalone and paste its
  p50/p95/p99 output and exit code into the handoff as the acceptance evidence. If p95 is at or
  over 500 ms, that is a real finding, not a flaky gate — investigate (likely candidates: the 50
  worlds sharing one Node event loop with no `--max-old-space-size` tuning, or a step that is
  accidentally doing real I/O) before writing DONE; do not loosen the 150 ms model-delay constant to
  make the number look better.

## Gate
`corepack pnpm turbo run build typecheck lint test --filter=@edmate/harness` green (covers steps 1,
2, 4 — the new script in step 3 is intentionally outside this gate's reach, see "Runs in CI?"
above); `python3 .githooks/secret-scan.py --all` clean. Manually run
`node packages/harness/scripts/loadTest50.ts` once and record its output in the handoff.

## Risk paths
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `packages/harness/scripts/**`,
`packages/harness/src/testing/**` and `docs/try-it.md` match no glob in the file. The script calls
the real guardrail/pedagogy steps but does not modify `packages/harness/src/guardrails/**` or
`packages/harness/src/pedagogy/**`.

## Reviewers
code-reviewer, typescript-reviewer (standard pair for a non-risky `@edmate/harness` change; no
security-reviewer or safety-reviewer needed, since no guard logic, access path or contract
changes).

## Open questions
None.
