# Task 7.7 — Turn traces and health metrics

## Acceptance (verbatim)
> p50/p95 latency (incl. live first token), error and guard rates computed from traces.

PRD tie-in (S5): "First words of a reply in under 2 seconds (p95)". Build plan § Turn pipeline
spec (line 308): "harness overhead p95 < 500 ms with the scripted gateway (13.2); first token
< 2 s p95 live (measured in 7.7)". 13.2 already measures harness overhead with the scripted
gateway; 7.7's job is the piece 13.2 can't give us: a real time-to-first-token number, plus
error/guard rates, computed from the `TurnTrace` records the harness already writes.

## How it will be shown
Two new unit-test suites, run in CI with no model or db calls:
1. `packages/harness/src/pipeline/trace.test.ts` (extended) and a runner-level test — prove that
   a turn which streams a token gets a `firstToken` entry in `trace.steps` with a plausible ms
   value, that a turn which never streams one has no such entry, and that it reflects the first
   token only once (not re-marked on a retry).
2. `packages/harness/src/metrics/health.test.ts` (new) — feed `computeHealthMetrics` a fixed,
   synthetic array of `TurnTrace`-shaped objects (no model/db calls needed, it's a pure function)
   and assert exact p50/p95, error-rate and guard-rate numbers for a known input, including the
   nearest-rank percentile formula's rounding.
3. `packages/db/test/repositories.int.test.ts` (extended CASES map) and
   `packages/db/test/trace-sink.int.test.ts` (extended) — prove the new teacher-scoped read
   returns only that teacher's traces, respects the time window and a row cap, and that its
   output round-trips through `computeHealthMetrics` to a sane report for a seeded teacher.

The PR description will show the health-metrics unit test's input/output pair and the isolation
test's "other teacher sees nothing" case, which is the acceptance criterion made concrete.

## Scope decision — no contracts change, no CLI/API surface this task
`TurnTraceSchema.steps[].name` is already `z.string()` (not an enum), so a new kind of entry
(`firstToken`) fits inside the existing contract with zero changes to `packages/contracts`.
Confirmed by reading `packages/contracts/src/trace.ts`. **No ADR needed.**

The Definition of done doesn't require a UI or CLI surface (no UI change here; accessibility
checks don't apply), and the accept line only asks that the numbers be *computed from traces* —
not reported anywhere yet. I'm scoping 7.7 to the computation (harness) and the ability to fetch
real traces for it (db), and leaving a CLI/staff-facing report as a follow-up, noted below as a
decision for the lead. This keeps both phases small and avoids a third package (`apps/cli`) and
the busy `packages/evals` package in this task.

## Design

### 1. Capturing first-token latency (packages/harness, no contracts change)
- `Turn.run()` (`packages/harness/src/pipeline/runner.ts` ~L398) already does nothing with a
  start time beyond `this.receivedAt` (an ISO string). Add `private startedAtMs = 0;` set to
  `this.deps.clock.now()` as the very first line of `run()`.
- `Turn.emitter()` (~L272) sets `this.shown = true` the first time a `token` or `skill` event is
  pushed. Add a one-shot capture there, **for `type === 'token'` only** (the PRD metric is about
  "first words of a reply", not skill/tool events): on the first token event, call
  `this.trace.markElapsed('firstToken', this.deps.clock.now() - this.startedAtMs)`.
- `TraceBuilder` (`packages/harness/src/pipeline/trace.ts`): add
  `private extra = new Map<'firstToken', number>();` and
  `markElapsed(name: 'firstToken', ms: number): void { if (!this.extra.has(name)) this.extra.set(name, ms); }`
  (idempotent: first call wins, so a cleared-and-retried stream doesn't double-count or get
  overwritten by the fallback attempt's first token — the number that matters is the first time
  the student saw *anything*, even if it was later retracted by a retry).
- `TraceBuilder.build()`: after the `STEP_NAMES.flatMap(...)` steps, append one more entry per
  `extra` key present: `{ name, ms, outcome: 'ok' }`. Omit entirely when no token was ever shown
  (error turns, `ask_teacher`-only turns, blocked turns) — same convention the spec already uses
  for `escalate` (present only when that path ran; see `runner.test.ts` L119).
- No change to `STEP_NAMES`/`STEP_SPEC` in `spec.ts`: `firstToken` is not one of the 11 spec
  steps, it's a derived metric riding in the same array because the schema allows it.

**Known collateral**: several existing tests assert the *exact* list of step names via
`trace.steps.map((s) => s.name)).toEqual(STEP_NAMES.filter(...))` — e.g. `runner.test.ts` ~L119,
`trace.test.ts` ~L42 and ~L64. These will need a `firstToken` added to the expected list for any
case whose turn streams a token (most happy-path tests do). Grep `trace.steps` across
`packages/harness/src/pipeline/*.test.ts` (7 files currently: `assemble.test.ts`,
`runner.test.ts`, `policies.test.ts`, `runner.generate.test.ts`, `turn.integration.test.ts`,
`trace.test.ts`, `concurrency.test.ts`) and fix the ones with exact-list assertions; most other
references are `.find((s) => s.name === ...)` lookups, which are unaffected. Expect this to be
most of the Phase A effort.

### 2. Health-metrics computation (packages/harness, pure, no new deps)
New `packages/harness/src/metrics/health.ts` (+ `health.test.ts`, `index.ts` barrel exported from
`src/index.ts`). Imports only `@edmate/contracts` types — no db, no zod needed for the output
shape (nothing crosses a port here; it's an in-process computation over values already
schema-validated on the way in).

```ts
export interface LatencyStats { p50: number; p95: number; n: number }
export interface HealthMetrics {
  turns: number;
  stepLatencyMs: Partial<Record<string, LatencyStats>>; // keyed by trace.steps[].name, incl. "firstToken"
  errorRate: number;                 // turns with >=1 step outcome 'failed', / turns
  errorsByStep: Partial<Record<string, number>>;
  guardRate: number;                 // turns with >=1 guard { ok: false }, / turns
  guardsByName: Record<string, number>;
}
export function computeHealthMetrics(traces: readonly TurnTrace[]): HealthMetrics
```

- Percentiles: nearest-rank, `sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * n) - 1)]`,
  `n = 0` → `{ p50: 0, p95: 0, n: 0 }` (documented, not NaN).
- "Latency" is reported **per step name** (including the new `firstToken` entry), not as one
  blended total-turn number: steps 3/4/6 run concurrently (build plan line 308), so summing all
  `steps[].ms` would overstate wall-clock turn time. `stepLatencyMs.generate` and
  `stepLatencyMs.firstToken` are the two numbers that matter most operationally; the others are
  free diagnostics from the same loop. (Flagged as a decision below — the spec doesn't define
  "latency" more precisely than the PRD's first-token number.)
- `errorRate`/`guardRate` are computed per *trace* (turn), not per step/guard instance, matching
  "error and guard rates" (plural metrics, turn-level rates) in the accept line.
- Tests: construct `TurnTrace` fixtures inline (schema-valid, satisfying the "no new `any`, all
  external input zod-validated" DoD line isn't in play since this is internal, already-typed
  data) covering: all-ok turns, a turn with a failed step, a turn with a blocking guard, a turn
  with no `firstToken` entry (excluded from that stat's `n`), and a percentile case with a known
  array (e.g. 20 values) to pin the exact formula.

### 3. Teacher-scoped trace reads for a window (packages/db)
`packages/db/src/repositories/turn-traces.ts` currently only has `listForSession` and
`findForTurn`, both `StudentScope`-gated to one session. Health metrics need traces across a
teacher's sessions for a time window — mirror the existing
`usageLedgerRepo.sumForTeacherSince(scope: TeacherScope, since: string)` pattern (already proven
safe: joins `sessions.teacherId = scope.teacherId`), rather than inventing a new scope type.

Add:
```ts
async listForTeacherSince(
  scope: TeacherScope,
  since: string,
  limit = TEACHER_TRACES_MAX_LIMIT,
): Promise<TurnTraceRow[]>
```
joining `turnTraces` → `sessions` on `sessions.teacherId = scope.teacherId`, filtering
`turnTraces.createdAt >= since`, ordered oldest-first, capped at `limit` (new exported constant,
pick a number consistent with existing `*_MAX_LIMIT` constants, e.g. `NOTIFICATIONS_MAX_LIMIT`'s
neighbourhood — exact value is a decision, not a spec requirement).

Changes:
- `packages/db/src/repositories/turn-traces.ts`: new method, reusing `COLUMNS`/`toRow`.
- `packages/db/src/repositories/index.ts`: no new export needed beyond what's already exported
  (`TurnTraceRow`, `teacherScope`/`TeacherScope` already exported) — double-check during build.
- `packages/db/test/repositories.int.test.ts`: new `'turnTraces.listForTeacherSince'` CASE,
  modelled exactly on `'usageLedger.sumForTeacherSince'` (~L1894): `scope: 'teacher'`,
  `targeted: false`, `call`/`random` over the seeded teachers, `owners` extracting
  `teacherOfId`-equivalent markers from the returned rows' `steps` (same trick
  `'turnTraces.listForSession'` already uses, ~L982).
- `packages/db/test/trace-sink.int.test.ts`: extend with a focused test for the time-window bound
  and the row cap (two traces either side of `since`; more rows than `limit`), and one test that
  pipes the method's output straight into `computeHealthMetrics` (harness) to show the two layers
  compose — this is the closest thing to an end-to-end demonstration of the accept line, without
  needing a CLI.

No migration: `turn_traces` already has every column needed; only a new index question (see
Decisions) is optional, not required for correctness.

## Files to create
- `packages/harness/src/metrics/health.ts`
- `packages/harness/src/metrics/health.test.ts`
- `packages/harness/src/metrics/index.ts`

## Files to modify
- `packages/harness/src/pipeline/trace.ts`
- `packages/harness/src/pipeline/trace.test.ts`
- `packages/harness/src/pipeline/runner.ts`
- `packages/harness/src/pipeline/runner.test.ts` (and whichever of `assemble.test.ts`,
  `policies.test.ts`, `runner.generate.test.ts`, `turn.integration.test.ts`,
  `concurrency.test.ts` turn out to have exact-list `trace.steps` assertions — audit all seven)
- `packages/harness/src/index.ts` (export `./metrics/index.js`)
- `packages/db/src/repositories/turn-traces.ts`
- `packages/db/test/repositories.int.test.ts`
- `packages/db/test/trace-sink.int.test.ts`

Roughly 10-12 files across two packages — too big for one phase per the sizing rule, so this is
split into two phases below. Each phase stays inside one package, matching "one builder per
package at a time" (and conveniently, `packages/db` is free — only `packages/evals` is busy with
5.9).

## Files out of bounds
- `packages/contracts/**` — not touched; any temptation to add a dedicated `firstTokenMs` field
  or loosen `steps[].name` to an enum must stop and come back to the lead (that's an ADR).
- `packages/evals/**` — busy with 5.9; this task doesn't need it (health metrics are about
  production turns, not eval suites).
- `apps/cli/**`, `apps/web/**` — no reporting surface in this task (see Scope decision above).
- `packages/harness/src/guardrails/**`, `.../pedagogy/**`, `.../access/**` — not touched; keep it
  that way so this stays out of the safety-reviewer path.

## Tests first (TDD order)
Phase A:
1. `trace.test.ts` — a failing test for `markElapsed`/`firstToken` presence and idempotency,
   then the implementation.
2. A runner-level test (new or extended `runner.test.ts`) proving the real pipeline records
   `firstToken` on a streamed turn and omits it on a blocked/error turn.
3. Fix the exact-list assertions in the other six files (expected to fail once `firstToken`
   starts appearing; each fix is itself a tiny red→green).
4. `health.test.ts` — percentile formula, error rate, guard rate, missing-`firstToken` handling,
   all before `health.ts` exists (red), then implement.

Phase B:
1. `repositories.int.test.ts` CASE for `listForTeacherSince` (red against the old repo shape).
2. `trace-sink.int.test.ts` time-window/limit tests.
3. `trace-sink.int.test.ts` compose-with-`computeHealthMetrics` test (imports
   `@edmate/harness`'s new export — first real cross-package proof this works end to end).

## Phase A — packages/harness (first-token capture + computeHealthMetrics)
Files: the harness list above (trace.ts, trace.test.ts, runner.ts, runner.test.ts + up to 5 more
pipeline test files, metrics/health.ts, metrics/health.test.ts, metrics/index.ts, src/index.ts).
Target: ~60-70 builder calls (most of it is the collateral-test audit, which is mechanical once
the first failing test shows the actual diff).
Green commit: `typecheck lint test --filter=@edmate/harness` passes; `computeHealthMetrics` is
exported from `@edmate/harness`.
State after this phase: first-token latency is captured in real traces and a pure function can
turn any array of `TurnTrace`s into p50/p95/error/guard numbers — demonstrable today against
fixtures, just not yet against real stored traces.

## Phase B — packages/db (teacher-scoped trace reads)
Files: turn-traces.ts, repositories.int.test.ts, trace-sink.int.test.ts.
Depends on Phase A only for its last demonstration test (importing `computeHealthMetrics`); the
new repo method itself has no dependency on Phase A and could in principle run first, but
sequencing A→B keeps "one builder per package at a time" simple and lets B's demo test import a
real harness export instead of a stub.
Target: ~35-45 builder calls (int tests against the real seeded db are slower to iterate but the
surface area is small: one method, one CASE, two int-test additions).
Green commit: `typecheck lint test --filter=@edmate/db` passes (including the `.int.test.ts`
suite against the test db, no model calls); isolation test shows another teacher's traces never
appear.
State after this phase: 7.7's accept line is fully demonstrable — real traces, read per teacher
over a window, reduced to p50/p95 latency (including first token), error rate and guard rate —
via tests, with no CLI/UI yet.

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` — **risky** (listed under "the access filter... keeping each
  teacher's and student's data apart"). Reviewers required: **security-reviewer**. Phase B's
  handoff needs a `risk: high` decision entry. The isolation-test CASE is exactly the mechanism
  that proves no cross-teacher leak; call that out for the reviewer.
- `packages/harness/src/pipeline/**` — not listed in risk-paths.txt (only `guardrails/**`,
  `pedagogy/**`, `access/**` under that package are risky). Phase A is not risky by this file;
  standard `code-reviewer` only.
- `packages/contracts/**`, `.claude/**`, `.githooks/**` — not touched.

Recommend `database-reviewer` for Phase B as good practice (new cross-session SQL query, even
though risk-paths.txt only mandates it for migrations that drop/delete data, which this isn't).

## Decisions to log (spec doesn't define these — logged on merge, not blocking)
1. **First-token definition**: elapsed time from turn start (first line of `Turn.run()`) to the
   first `token` event pushed to the student's event queue, kept even if a later retry clears and
   replaces the shown text (recommendation above; alternative would be "first token of the
   attempt that ultimately won," which needs an extra field to track and seems less useful for an
   operational SLA).
2. **"Latency" is reported per step name, not as one blended total**, because steps 3/4/6 run
   concurrently and summing would overstate wall-clock time; `firstToken` and `generate` are the
   two operationally meaningful ones.
3. **No CLI/staff-facing report in this task** — recommend a small follow-up board task (M7 or
   M9's staff console work) to expose `computeHealthMetrics` + `listForTeacherSince` through a
   command or trust-console page, once there's an actual consumer asking for it.
4. **`TEACHER_TRACES_MAX_LIMIT` value and whether to add a `turn_traces` index** for the new
   time-window query — pilot-scale traffic doesn't need it yet; note as a follow-up if query
   plans in the int test look slow.
5. **Error rate / guard rate are turn-level** (did this turn have ≥1 failed step / ≥1 blocking
   guard), not instance-level; both are also broken down by step/guard name for diagnosis.

## Open questions
None — no unclear spec or decision needs a human call before building; all judgement calls above
have a stated recommendation and are logged rather than blocking.

## Lead answers (21 Oct 2026)
- READY as planned. Phase A (harness) builds first on Sonnet. Phase B (db) uses a fresh builder after Phase A's handoff. Phase B adds database-reviewer next to security-reviewer.
- The CLI or staff report surface is out of scope; the lead adds a follow-up board task on merge.
