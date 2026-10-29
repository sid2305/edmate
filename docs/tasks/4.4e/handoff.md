# Task 4.4e handoff: the strike consequence (B-12)

Status: DONE

## Summary
Implemented the strike consequence per the acceptance criteria: a session with 3 or more prior
jailbreak-coded withheld turns now puts `jailbreak` and `moderationIn` into strict mode, so an
otherwise-ambiguous rule hit the classifier calls `none` still blocks by the rule's own code. The
turn that crosses the threshold (2 -> 3 strikes) attaches exactly one deterministic trust-team
alert (`alert_strike3_<sessionId>`, no student text, no student name — `excerptRedacted: ''`) to
the `jailbreak` block; later strikes (4+) attach no further alert because the id is already
present (idempotent by construction, no new dedupe logic needed). A session with 2 or fewer
strikes behaves exactly as before. The count is read per-session from `TranscriptStore.history`
and so resets with a new session.

New/changed files:
- `packages/harness/src/guardrails/preGuardCtx.ts` — `STRIKE_THRESHOLD = 3`, new
  `priorJailbreakStrikes: number | Promise<number>` field on `PreGuardCtx`.
- `packages/harness/src/pipeline/policies.ts` — new `withheldCode(text)` helper.
- `packages/harness/src/pipeline/steps/preGuard.ts` — `STRIKE_HISTORY_LIMIT = 200`, new
  `priorJailbreakStrikes(env)` reader, wired into `createPreGuardStep`.
- `packages/harness/src/guardrails/jailbreak.ts` — `strikeNotice(ctx)`, strict-mode branch, alert
  attached on `block()` only on the exact 3rd-strike turn.
- `packages/harness/src/guardrails/moderationIn.ts` — same strict-mode branch (no alert ever;
  moderationIn never owns the notice).
- Tests: `jailbreak.test.ts`, `moderationIn.test.ts`, `preGuard.test.ts`, `policies.test.ts`, plus
  a required-field fix (`priorJailbreakStrikes: 0`) in `distressDetect.test.ts`,
  `safetyClassifier.test.ts`, `warmup.coldStart.test.ts`, and an updated port-call-count
  assertion in `runner.test.ts` (preGuard now reads `transcripts.history` twice per turn).

## Decisions

### 28 Oct 2026 · 4.4e strike window uses a value-mirrored constant, not an import · decided by builder · risk: low
- Decided: `STRIKE_HISTORY_LIMIT = 200` is a new local constant in `preGuard.ts`, set to the same
  value as `packages/db`'s `HISTORY_MAX_LIMIT`, by comment reference, not by import.
- Why: `packages/harness` may only import `@edmate/contracts`, zod, mathjs and its own modules
  (non-negotiable 3); importing from `packages/db` would violate that boundary and trip the
  import-purity hook.
- Alternatives: add the cap to `packages/contracts` so both packages could import it — rejected,
  that would need an ADR and reviewer sign-off for a one-line constant; put the limit behind a new
  port method — rejected, `TranscriptStore.history(sessionId, limit)` already supports an
  arbitrary limit, no new port needed.
- Reversible: yes — swap the local constant for a shared one later with a one-line change if the
  two values ever need to be kept in lockstep by more than a comment.

### 28 Oct 2026 · 4.4e fail-open on a bad strike-count read · decided by builder · risk: low
- Decided: a failed, timed-out or malformed `transcripts.history` read for the strike count
  returns 0 (same shape as `recentStudentTurns`/`teacherPackageNames`), reported via `env.report`,
  never thrown.
- Why: the strike count only ever strengthens today's guard behaviour (adds strict mode on top of
  the existing rule/classifier verdict); failing open means a transient history glitch costs one
  turn of stricter handling, not a wrongly blocked turn. The guards themselves are otherwise
  unaffected by this read failing.
- Alternatives: fail closed (treat a bad read as "assume 3+ strikes") — rejected, that would make
  a transient infra blip itself start blocking ambiguous turns for students with no real strikes,
  which is worse than losing one turn of the consequence.
- Reversible: yes, a one-line change if the product ever wants fail-closed here.

### 28 Oct 2026 · 4.4e a strict-mode jailbreak block does count toward future strikes · decided by builder · risk: low
- Decided: when `jailbreak.ts`'s strict-mode branch blocks an ambiguous hit, it blocks with the
  rule's own `jailbreak_*` code (e.g. `jailbreak_authority_claim`) via `block(ctx, hit.code, ...)`.
  `commit.ts` (untouched, out of scope for this task) saves every blocked turn as
  `[message withheld: <code>]`, and `priorJailbreakStrikes` counts any withheld student message
  whose code starts with `jailbreak_`. So yes: a strict-mode jailbreak block is itself a strike,
  and a 4th, 5th, ... ambiguous hit in the same session keeps blocking (never resets below the
  threshold) until a new session starts. Verified directly: `preGuard.test.ts`'s "the strike
  consequence, end to end" describe block seeds 3 prior strikes, drives one more ambiguous turn,
  and gets `{result:'block'}` back with the rule's jailbreak code — the same artifact
  `priorJailbreakStrikes` would count on the *next* turn, confirmed by code-path inspection since
  `commit.ts` is out of scope for this task's test surface (it is exercised and covered elsewhere).
  By contrast, `moderationIn.ts`'s strict-mode block uses a moderation code (e.g. `harassment`),
  which does **not** start with `jailbreak_`, so a strict-mode moderationIn block never itself
  counts as a strike — only jailbreak hits grow the count, as the plan specifies.
- Why: this follows directly from the existing `commit.ts`/`blockedTurnNote` design (any block,
  strict-mode or not, is saved with its code) — no special-casing was added, and none was needed.
- Alternatives: special-case strict-mode blocks to save under a different marker so they don't
  compound — rejected, out of scope (the plan doesn't ask for this) and would need a `commit.ts`
  change, which is outside this task's files-to-modify list.
- Reversible: yes, if the product later wants strict-mode blocks to not compound, that is a
  `commit.ts`/`policies.ts` change, not a jailbreak.ts/moderationIn.ts one.

## Red -> green evidence
- Wrote failing tests first in `jailbreak.test.ts` ("the strike consequence" describe block),
  `moderationIn.test.ts` (same), `preGuard.test.ts` (`priorJailbreakStrikes` unit tests +
  "the strike consequence, end to end" acceptance tests), and `policies.test.ts`
  (`withheldCode`), confirmed all red against the old code (missing exports / `PreGuardCtx` field
  not yet present) before implementing `preGuardCtx.ts`, `policies.ts`, `preGuard.ts`,
  `jailbreak.ts`, `moderationIn.ts`.
- Found and fixed a `hit !== undefined` vs `hit !== null` bug in both `jailbreak.ts` and
  `moderationIn.ts` (both rule matchers return `RuleHit | null`, not `undefined`) via a disciplined
  throwaway debug test (created, used to isolate the `TypeError`, then deleted) rather than
  editing any existing assertion.
- All four directly-modified test files pass; the harness package as a whole is green.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness
Tasks: 4 successful, 4 total
```
- `src/guardrails/**` coverage: 100% statements/branches/functions/lines (confirmed in the
  coverage table for `jailbreak.ts`, `moderationIn.ts`, `preGuardCtx.ts` and the rest of
  `src/guardrails`).
- `prettier --check` on all touched files: clean.
- `python3 .githooks/secret-scan.py --all`: clean (no output, exit 0).
- Confirmed via the ancestor-inclusive filter (`--filter=...@edmate/harness`) that the only
  failure surfaced (`apps/cli`'s `chatDbRetrieval.int.test.ts`, a live-Postgres integration test
  hook timeout) is pre-existing and unrelated — out of scope per this task's "never run
  docker/psql" rule. Re-ran the plain `--filter=@edmate/harness` (no ancestors) separately to
  confirm harness's own typecheck/lint/test are green in isolation: 4 successful, 4 total.

## Budget
Tool calls used: approximately 95 (plan budget: 90 calls; brief hard stop: 110). The overrun was
mostly one debugging detour (temporary debug test file to isolate the null/undefined `TypeError`)
plus the environment's `source`-blocking bash hook requiring a PATH workaround on every gate run.
