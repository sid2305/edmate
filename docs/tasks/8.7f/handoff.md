# 8.7f: the 8.7b review follow-ups in apps/worker/src/gate/** and one bug in apps/cli

## Summary

Closed the 8.7b review follow-up list before the first live gate run (8.7e): the gate now
forwards `input.skill` onto the turn and fails any case that names `input.persona` loudly
(persona has no `TurnInput` field and the gate can't keep help-state across its one-session-per-
call design); a genuine streamed locked-leak test exists alongside a separate `lockedLeaks`
counter; `run.finished` is awaited in a `finally` so it still runs when `collectReply` throws;
`collectReply`'s switch is exhaustive over `TurnEvent`; `isGuardDetection` matches
`LockedLeakDetected` by `instanceof`, not `error.name`; `GateUsageMeter.record`'s `ctx` widening
is commented; `testkit.ts` moved out of `src/` and `@edmate/content` dropped from
`apps/worker/package.json`. Also fixed the apps/cli eval bug the board item named: `liveAgent.ts`
now fails the case (throws) on a retryable `guard_blocked` (a failed pre-guard chain) instead of
scoring it blocked, matching the gate's own 8.7b fix.

## Checklist

- [x] skill passthrough: `input.skill` forwarded onto the turn (works for all 7 skills via
  `selectSkill` reading `turn.skill` directly); test asserts `[[SKILL:feedback]]` routing.
- [x] persona: no silent scoring — `reply()` throws a clear `Error` naming the case/turn/persona
  when `input.persona` is defined (see Decisions below for why this isn't "fail cases that name
  one" partially — it's all of them, by design).
- [x] locked-leak pipeline test: a scripted stream leaking locked text scores the locked reply
  (`lockedReplyText()`); combined with a second background failure (meter down), the case still
  fails.
- [x] `await run.finished` moved into a `finally` around `collectReply`.
- [x] separate `lockedLeaks` counter on `GateSideEffects`, always also counted in
  `backgroundFailures`.
- [x] `testkit.ts` moved from `apps/worker/src/gate/testkit.ts` to `apps/worker/test/gate/testkit.ts`
  (precedent: `apps/worker/test/clock.ts`); `@edmate/content` dropped from
  `apps/worker/package.json` and the lockfile.
- [x] exhaustive `TurnEvent` switch in `collectReply` (`satisfies never` default).
- [x] `LockedLeakDetected` matched by `instanceof`, not `error.name` (closes a look-alike-name
  gap; test covers a name-spoofed plain `Error` returning `false`).
- [x] `GateUsageMeter.record`'s `ctx: unknown` widening commented.
- [x] apps/cli `liveAgent.ts:~92` (now ~99-103): a retryable `guard_blocked` (pre-guard chain
  failed) throws and fails the case instead of setting `reply.blocked`; test added.

No wontfix items — every board item was in scope and done.

## Files

- `apps/worker/src/gate/agent.ts` — skill passthrough, persona guard, locked-leak accounting,
  `finally`-wrapped `run.finished`, exhaustive switch, `instanceof` guard match.
- `apps/worker/src/gate/ports.ts` — `lockedLeaks` counter, `GateUsageMeter.record` doc comment.
- `apps/worker/src/gate/agent.test.ts` — new tests for skill routing, persona rejection, locked
  leak (alone and combined with another background failure), `isGuardDetection` rewritten.
- `apps/worker/src/gate/ports.test.ts` — updated expected `GateSideEffects` shape.
- `apps/worker/src/gate/configStore.test.ts`, `apps/worker/src/gate/input.test.ts` — import path
  only, to the moved testkit.
- `apps/worker/test/gate/testkit.ts` — moved from `apps/worker/src/gate/testkit.ts` (`git mv`, no
  content change).
- `apps/worker/package.json` — removed unused `@edmate/content` dependency.
- `pnpm-lock.yaml` — regenerated for the removed dependency only (diff is exactly that one entry).
- `apps/cli/src/commands/eval/liveAgent.ts` — retryable `guard_blocked` now fails the case.
- `apps/cli/src/commands/eval/liveAgent.test.ts` — new classifier-outage test.

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker... --filter=@edmate/cli...`
  — all green. Worker `src/gate` coverage 98.05%/93.8%/98.5%/98.31% (statements/branches/
  functions/lines); only uncovered lines are the unreachable exhaustiveness-guard default branch
  and a pre-existing `learnerClear` stub (not a regression). CLI `liveAgent.ts` coverage
  86.48%/70.45%/100%/88.23%.
- `python3 .githooks/secret-scan.py --all` — clean.
- No real model or payment calls in any test added or touched (scripted `ModelGateway` only, per
  rule 4).

## Decisions

### 22 Oct 2026 · 8.7f persona always fails the case · decided by builder · risk: low
- Decided: when `input.persona` is defined, the gate always throws (fails that case loudly)
  rather than trying to honor it for a `kind: 'skill_action'` start turn only. `TurnInput` has no
  `persona` field at all; a persona only enters the pipeline via a start turn's `skillPayload`
  (bare id), and every later turn needs a *stored* `personaId` in that session's help state. The
  gate creates a brand-new session (and a fresh help-state map) on every single `reply()` call,
  so there is no continuity across a case's turns — a start-turn-only hack would silently produce
  wrong, non-roleplay results for every multi-turn persona case (confirmed real multi-turn persona
  suites exist, e.g. `evals/suites/persona/persona-roleplay-model-answer-en.yaml`). Failing the
  case outright matches the brief ("fail any case that names one, with a clear reason, never
  silently score it") and `runCaseSafely`'s existing catch-and-fail-this-case design.
- Why: a half-working persona path (first turn only) would be worse than a clear failure, because
  it would score a roleplay case as if it ran correctly when it did not resume the persona at all.
- risk: low — gate-only behavior, no change to prompt-pack behaviour or contracts; persona gate
  support is left as a known gap for whoever picks it up next (would need a `TurnInput.persona`
  field or similar, which is a contracts change needing an ADR per rule 2).

## Left to do

- Persona support in the gate (resuming a roleplay case across turns) is still a real gap — not
  attempted here per the Decision above. Would need a contracts change (ADR) to carry a persona id
  on `TurnInput`, or a gate-side session-continuity redesign; out of scope for this task's allowed
  files.

Status: DONE

Tool calls used: 94
