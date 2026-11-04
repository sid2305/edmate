# Handoff: 4.4h

Status: DONE

## Summary
Narrowed the three deferred 4.4 review LOWs: `CommitRecord.withheldCode` (types.ts) and
`Turn.sendBlockReply`'s `code` parameter (runner.ts) now both type `Exclude<SafetyEventCode,
'self_harm'> | undefined`, matching `PreGuardResult`'s existing `'block'` branch. A third call site
not named in the plan — `Turn.ruleTableFallback`'s `{ kind: 'block'; code: string; ... }` return
(added by 4.3b's scrub-failure branch, post-dating the plan's "read first" grep) — also needed the
same narrowing; `ruleFallback.code` is passed straight into `sendBlockReply`, so leaving it `string`
broke the build (`tsc` error TS2345 at the `build` step, not `typecheck`, since `@edmate/contracts`
re-exports `SafetyEventCode` as a literal union and the build step's stricter emit caught it first).
Narrowed it to the same `Exclude<SafetyEventCode, 'self_harm'>` — both `modHit.code` (after the
`self_harm` branch is handled) and `jbHit.code` already satisfy this type, so no other change was
needed. `type SafetyEventCode` was added to runner.ts's existing `@edmate/contracts` import list.

`runner.block.test.ts`'s indentation LOW no longer reproduces: `prettier --check` is clean on it
(no edit made). The `describe('runTurn: a pre-guard block with a reply', ...)` section (the likely
target of the original review) uses consistent 2-space-step indentation throughout, e.g.:
```
  it(
    'a moderation block: the hate reply, then done; saved blocked with the reply',
    async () => {
      ...
      expect(steps.commits[0]?.withheldCode).toBe('hate');
```
Likely fixed incidentally by a later merge (4.4c/4.4d landing test cases in this file), per Open
question 2.

Added the `expectTypeOf` link to `apps/worker/src/alerts/safetyEvents.test.ts` per the plan's Q1
recommendation (not inside `packages/queue`, which would need a new, test-only `@edmate/db`
production dependency). Manually perturbed `packages/queue/src/queues.ts`'s
`SafetyEventSourceSchema` (added a third enum value as a scratch edit), confirmed `tsc --noEmit`
failed at the new `expectTypeOf` line in both `safetyEvents.test.ts` (TS2344) and the
unrelated production call site `safetyEvents.ts(42,9)` (TS2322 — a bonus confirmation the type
flows through the real processor too), then reverted (`git diff` on `queues.ts` is empty).

## Decisions

### 4 Nov 2026 · 4.4h queue/db enum link location · decided by builder · risk: high
- Decided: the `expectTypeOf` link between `SafetyEventJob` and `SafetyEventInput` lives in
  `apps/worker/src/alerts/safetyEvents.test.ts`, not inside `packages/queue` (the task title says
  "(packages/queue)").
- Why: `packages/queue` depends on `@edmate/contracts`, `bullmq`, `ioredis`, `zod` — not
  `@edmate/db`; adding `@edmate/db` purely for a test-only type check would be a new, one-off
  production dependency. `apps/worker` already depends on and imports both packages' real types
  in this same test file.
- Alternatives: add `@edmate/db` as a dev dependency of `packages/queue` just for this test
  (rejected — a new dependency for a test-only purpose, against the task's zero-new-dependency
  intent); skip the link entirely (rejected — defeats the LOW's purpose).
- Reversible: yes — moving the block is a small diff either way.

### 4 Nov 2026 · 4.4h indentation LOW already resolved · decided by builder · risk: low
- Decided: no edit made to `runner.block.test.ts`; `prettier --check` reports it clean.
- Why: the file has had other 4.4-series tasks (4.4c, 4.4d) land test cases in it since the
  original review was written; the `describe('runTurn: a pre-guard block with a reply', ...)`
  section (the likely target) already shows consistent indentation.
- Alternatives: re-run prettier `--write` anyway (rejected — would produce a no-op diff and risk
  masking whether the LOW ever reproduced for the next reader).
- Reversible: n/a (no change made).

### 4 Nov 2026 · 4.4h third narrowing site (ruleTableFallback) · decided by builder · risk: low
- Decided: narrowed `Turn.ruleTableFallback`'s return type's `code: string` to
  `Exclude<SafetyEventCode, 'self_harm'>`, in addition to the two sites the plan named.
- Why: 4.3b added this method/call site after the plan's "read first" grep was written (the plan's
  own caveat: "every line number below is pre-4.3b... locate every edit by symbol"); its `code`
  value flows into `sendBlockReply`'s now-narrower parameter and the build step failed without it.
  Both of its producers (`modHit.code` past the `self_harm` check, `jbHit.code`) already satisfy
  the narrower type, so this is still a type-only change, consistent with the plan's intent.
- Alternatives: widen `sendBlockReply`'s parameter back to `string` at this one call site via a
  cast (rejected — reintroduces the exact widening this task removes); leave it and report
  BLOCKED (rejected — in-scope file, in-scope type family, no behaviour change, no new
  dependency, not a guardrails/pedagogy/contracts file).
- Reversible: yes.

## Red -> green evidence
- Type-only narrowing (types.ts, runner.ts, runner.ts's `ruleTableFallback`): no red/green cycle
  possible (same precedent as 4.4f). Confirmed `withheldCode` assertions unchanged before editing
  (`runner.block.test.ts`'s `'hate'`/`'jailbreak_override'`/`undefined` cases,
  `steps/commit.test.ts`'s `withheldCode: 'hate'`) and unchanged after — `tsc --noEmit` clean, and
  `pnpm turbo run typecheck lint test --filter=...@edmate/harness` green.
- Indentation: `prettier --check packages/harness/src/pipeline/runner.block.test.ts` — clean on
  first run, no `--write` needed.
- `expectTypeOf` link: added, passes immediately (`6/6` in `safetyEvents.test.ts`); proven real by
  the manual perturbation above (red: TS2344/TS2322 with a third enum value added to
  `SafetyEventSourceSchema`; green: clean after revert, confirmed `git diff` empty on `queues.ts`).

## Gate
`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/queue --filter=...@edmate/worker`
- `@edmate/harness`: typecheck/lint/test green (64 `runner.test.ts` cases, 28 `preGuard.test.ts`
  cases, all `withheldCode` assertions unchanged).
- `@edmate/queue`: 7 test files, all passed.
- `@edmate/worker`: typecheck/lint green; `safetyEvents.test.ts` 6/6 passed (new `expectTypeOf`
  block included), `ingest/processor.test.ts` 49/49.
- Turbo's dependency graph (`...@edmate/worker`) also pulled in `@edmate/content`, whose
  `src/safeRegex.test.ts` timing-probe test ("the timing probe... catches `a?` x25 then `a` x25")
  intermittently times out at its 5 s budget on this machine — reproduced twice, passed standalone
  once (flaky, pre-existing, unrelated to any file this task touches; not in the plan's named
  filters). Final turbo tally both runs: 29/38 (harness+queue+worker) successful, only
  `@edmate/content#test` failed.
- `prettier --check` clean on all four touched/considered files.
- `python3 .githooks/secret-scan.py --all` clean (no output).
- `src/guardrails/**` coverage unaffected — no guard file touched.

## Budget
Budget: 35 tool calls (plan)
Tool calls used: 32
