# Plan: 4.4h — the three 4.4 review LOWs that 4.4f deferred

Board: `board.py show 4.4h` (M13, deps 4.4f done, 4.3b — read post-merge below).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "The three 4.4 review LOWs that 4.4f deferred: narrow withheldCode/code to the
SafetyEventCode subset (runner.ts, types.ts); fix the indentation in runner.block.test.ts; add
expectTypeOf links between the queue and db safety-event enums (packages/queue). Start after 4.3b
merges, because 4.3b owns runner.ts and types.ts."
Accept: "the three remaining LOWs in docs/tasks/4.4/review.md are fixed (type-only changes proven
by typecheck; the indentation by prettier/lint); the gate passes with
`--filter=...@edmate/harness` and `--filter=...@edmate/queue`."

### How it will be shown (paste into handoff.md)
| Item | Evidence |
|---|---|
| `withheldCode`/`code` narrowed | `types.ts`'s `CommitRecord.withheldCode` and `runner.ts`'s `Turn.sendBlockReply`'s `code` parameter are both `Exclude<SafetyEventCode, 'self_harm'> \| undefined` (optional on the field); `tsc --noEmit` is clean; `runner.block.test.ts`'s and `steps/commit.test.ts`'s existing `withheldCode` assertions pass unchanged (no behaviour change, type-only). |
| `runner.block.test.ts` indentation | Either the odd indentation is found and fixed (prettier-clean diff) or the handoff shows it no longer reproduces (quote the current, correctly-indented lines and note which later merge likely fixed it) — see Open question 2. |
| queue/db safety-event enum link | A new `expectTypeOf` block in `apps/worker/src/alerts/safetyEvents.test.ts` ties `SafetyEventJob['guard']`/`['source']`/`['code']` (from `@edmate/queue`) to `SafetyEventInput['guard']`/`['source']`/`['code']` (from `@edmate/db`) — see Open question 1 for why this lives in `apps/worker`, not `packages/queue`. |
| Gate | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/queue --filter=...@edmate/worker` green (worker added — see Open question 1); `src/guardrails/**` coverage unaffected (nothing here touches a guard file). |

## Read first — post-4.3b, pre-4.7b-Phase-D state (do this before editing)
4.3b (branch `m13/4.3b-distress-followups`) is about to merge into `packages/harness/src/pipeline/runner.ts` and `types.ts`; 4.7b Phase D (a per-session turn queue wrapped around `runTurn`, near its entry point) lands in the same file before this task builds. **Every line number below is pre-4.3b/pre-4.7b and will have shifted** — 4.3b adds lines inside `Turn.run()`'s scrub-failure branch (before `sendBlockReply`) and in the escalate/finalize region, and 4.7b Phase D adds a wrapper near `runTurn`'s entry (before the `Turn` class body). Locate every edit by **symbol, not line number**:
- `grep -n "withheldCode" packages/harness/src/pipeline/runner.ts packages/harness/src/pipeline/types.ts` to find the current lines of: the `Turn.sendBlockReply` method's `code` parameter, the two `...(code === undefined ? {} : { withheldCode: code })` spreads inside `Turn.run()`/`sendBlockReply`, and `CommitRecord.withheldCode` in `types.ts`.
- Confirm `PreGuardResult`'s `'block'` branch still types its `code` field `code?: Exclude<SafetyEventCode, 'self_harm'>` (search `Exclude<SafetyEventCode` in `types.ts`) — this is the type both widened fields should match; do not change this field, only match it.
- Confirm `SafetyEventCode` is already imported as a type in `types.ts` (it is, in the `@edmate/contracts` import list) and whether it is imported in `runner.ts` (it is **not**, as of pre-4.3b `main` — add `type SafetyEventCode` to runner.ts's existing `@edmate/contracts` import list; contracts is an allowed harness import, rule 3, no new dependency).

## Files to modify
1. **`packages/harness/src/pipeline/types.ts`** — `CommitRecord.withheldCode?: string` → `withheldCode?: Exclude<SafetyEventCode, 'self_harm'>`. Type-only; no import change needed.
2. **`packages/harness/src/pipeline/runner.ts`** — `Turn.sendBlockReply`'s `code: string | undefined` parameter → `code: Exclude<SafetyEventCode, 'self_harm'> | undefined`. Add `type SafetyEventCode` to the existing `@edmate/contracts` import list (top of file). Type-only; the two `withheldCode: code` call sites already pass a value of this narrower type (from `pg.value.code`, itself typed via `PreGuardResult`), so no runtime change.
3. **`packages/harness/src/pipeline/runner.block.test.ts`** — the indentation fix, **if it still reproduces** (see Open question 2). Run `corepack pnpm exec prettier --check packages/harness/src/pipeline/runner.block.test.ts` first; if prettier reports no diff, the LOW is already resolved (by an incidental reformat in a later merge) — say so in the handoff with the current (correct) line quoted, and make no edit to this file. If prettier does report a diff, run `--write` on this file only (no other file) and show the before/after lines in the handoff.
4. **`apps/worker/src/alerts/safetyEvents.test.ts`** — add the `expectTypeOf` link (see "The queue/db enum link" below). This file already imports `@edmate/queue` (indirectly, via the processor under test) and the repo already imports `@edmate/db`'s `Repositories` type; both are existing `apps/worker` dependencies, so this is a zero-new-dependency change.

## Files out of bounds
`packages/harness/src/guardrails/**`, `packages/harness/src/pedagogy/**`, `content/prompt-packs/**`, `packages/contracts/**`, `docs/adr/**`, `packages/queue/src/queues.ts` (no production code change — see Open question 1), any file 4.3b or 4.7b Phase D is still actively editing on its own branch (`helpState.ts`, `replies.ts`, `steps/generate.ts`, `testSteps.ts`, `runner.test.ts`, `runner.sessionRace.test.ts`/`runner.grounding.test.ts`) — this task touches only the four files above.

## The queue/db enum link (why `apps/worker`, not `packages/queue`)
`packages/queue/package.json` depends on `@edmate/contracts`, `bullmq`, `ioredis`, `zod` — not `@edmate/db`. `packages/db/package.json` depends on `@edmate/harness` (among others) — not the reverse. Adding `@edmate/db` to `packages/queue`'s dependencies purely to type-check against an enum it never otherwise needs would be a new, one-off production dependency for a test-only purpose, and queue's description ("Queue-backed port adapters... apps/worker consumes the jobs") already treats db as something only its consumers touch. **No expectTypeOf approach inside `packages/queue` avoids a new dependency.**

`apps/worker` already depends on both `@edmate/queue` and `@edmate/db` (its `safetyEventProcessor` in `apps/worker/src/alerts/safetyEvents.ts` imports `SafetyEventJobSchema` from `@edmate/queue` and `Repositories` from `@edmate/db` on the same lines today), and its existing test file already imports both package's real types. Recommend: add the link there, in `apps/worker/src/alerts/safetyEvents.test.ts`:

```ts
import { expectTypeOf } from 'vitest';
import type { SafetyEventInput } from '@edmate/db';
import type { SafetyEventJob } from '@edmate/queue';

describe('SafetyEventJob and SafetyEventInput share one guard/source/code shape (4.4h)', () => {
  it('types line up', () => {
    expectTypeOf<SafetyEventJob['guard']>().toEqualTypeOf<SafetyEventInput['guard']>();
    expectTypeOf<SafetyEventJob['source']>().toEqualTypeOf<SafetyEventInput['source']>();
    expectTypeOf<SafetyEventJob['code']>().toEqualTypeOf<SafetyEventInput['code']>();
  });
});
```
Both `SafetyEventJob` (from `packages/queue/src/queues.ts`, re-exported `export * from './queues.js'` in `packages/queue/src/index.ts`) and `SafetyEventInput` (from `packages/db/src/repositories/safety-events.ts`, re-exported via `packages/db/src/repositories/index.ts` and `packages/db/src/index.ts`) are already public exports — no new export needed on either side. `expectTypeOf`/`toEqualTypeOf` is a compile-time-only check (vitest, already a dev dependency of `apps/worker`); a real divergence fails `tsc --noEmit` (the `typecheck` script), not the runtime test run.

## Tests first (tdd-guide order)
1. **Narrowing (types.ts, runner.ts):** no red/green cycle is possible — this is a type-only change with no behaviour change (same precedent as 4.4f's `jailbreak.ts` return-type annotation). The proof is: `tsc --noEmit` clean, and the existing `withheldCode` assertions in `runner.block.test.ts` (the `'hate'`/`'jailbreak_override'`/`undefined` cases) and `steps/commit.test.ts` (`withheldCode: 'hate'`) pass unchanged. Confirm this first, before editing, by noting the exact current assertions (search `withheldCode` as in "Read first" above) so the "unchanged" claim is checked, not assumed.
2. **Indentation (runner.block.test.ts):** `prettier --check` first (red only if it reports a diff); if red, `prettier --write` that one file only, then `--check` again (green). If already clean, no edit — document as resolved, not re-tested.
3. **expectTypeOf link:** write the block above; it is expected to pass immediately (both sides already share `SafetyEventCodeSchema` from `@edmate/contracts` and the same two-value `guard`/`source` enums) — this is not a red-then-green case either. To prove the link is real (would catch a future divergence), the builder locally perturbs one schema in a scratch edit (e.g. add a third value to `packages/queue/src/queues.ts`'s `SafetyEventSourceSchema` only, confirm `tsc --noEmit` on `@edmate/worker` now fails at the new `expectTypeOf` line, then revert) and records that manual check in the handoff — no committed test change for this step, same as other compile-time-only proofs in this plan.
4. Full gate (below) green.

## Gate
```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/queue --filter=...@edmate/worker
```
The accept line names only `--filter=...@edmate/harness` and `--filter=...@edmate/queue`; `--filter=...@edmate/worker` is added here because the queue/db link's actual edit lands in `apps/worker`, not `packages/queue` (see Open question 1 and the "Gate dependents in briefs" lesson — gate every package a change actually touches, not only the ones the brief named). `src/guardrails/**` coverage must not regress (unaffected; nothing here touches a guard file).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `apps/worker/src/alerts/**` — **matches** (student-safety group) → **reviewer: code-reviewer** (MVP-first rule, safety-reviewer waived until 13.3). The test-only addition is a safety-adjacent compile-time link (the safety-event code path), so the lead logs a `risk: high` decision on merge per rule 6, same posture 4.3b/4.7b used for their own `guardrails/**` test-only changes.
- `packages/harness/src/pipeline/**` (`runner.ts`, `types.ts`, `runner.block.test.ts`) — **no match**; `pipeline/**` is not on `risk-paths.txt` (confirmed, same finding 4.3b's and 4.7b's plans already recorded for this directory).
- `packages/queue/**` — **no match**; also no production file in this package is edited by this plan (see Open question 1).
- No match for `packages/contracts/**`, `.claude/**`, `.github/**`, `.githooks/**`, any payments/auth/db-repository path, or any guard/pedagogy file.

## Open questions (recommendations given; none blocking)
1. **Where the queue/db enum link lives.** The task title says "(packages/queue)" and the accept line's gate only names harness and queue. Per "The queue/db enum link" above, no option inside `packages/queue` avoids a new production dependency on `@edmate/db`. *Recommend:* put the link in `apps/worker/src/alerts/safetyEvents.test.ts` (zero new dependencies, uses already-public exports on both sides) and extend the gate to include `@edmate/worker`. Flag this in the handoff as a deviation from the literal task title/accept wording for the lead to confirm at review, not as a blocker — the accept line's underlying intent ("a compile-time link between the two copied enums") is met.
2. **Whether the `runner.block.test.ts` indentation LOW still reproduces.** The file has had other tasks (4.4c, 4.4d) land test cases in it since the 4.4 review was written, and reading the file today shows consistent 2-space-step indentation throughout the block the review likely meant (the `describe('runTurn: a pre-guard block with a reply'` section). *Recommend:* run `prettier --check` as the first step (not a visual guess); if clean, log in the handoff that this LOW appears already resolved by an incidental reformat in a later merge, with the current (correctly indented) lines quoted as evidence, and make no edit. If prettier finds a diff, fix it with `--write` on that one file only.
3. **Whether to also narrow the `code` variable at the pre-guard-block branch inside `Turn.run()`** (the `const code = pg.ok && pg.value.result === 'block' ? pg.value.code : undefined;` line). *Recommend:* no change needed — its type is already inferred from `pg.value.code` (itself `Exclude<SafetyEventCode, 'self_harm'> | undefined` via `PreGuardResult`), so it is not widened today; only the two explicit `string | undefined` annotations (the field and the parameter) need narrowing.

## Decisions to log on merge
- `risk: high`: the queue/db safety-event enum link is proven by a type-only `expectTypeOf` test in `apps/worker/src/alerts/safetyEvents.test.ts` (a risk-paths.txt safety group), not inside `packages/queue` (which would need a new, test-only production dependency on `@edmate/db`); the gate is extended to `@edmate/worker` accordingly.
- Whether the `runner.block.test.ts` indentation LOW still reproduced, and if not, what the handoff found instead.

## Budget
Budget: 35 tool calls (1 phase, `@edmate/harness` + `@edmate/worker`, `@edmate/queue` read-only)

## Allowed tools
Read, Grep, Glob, Edit, Bash (typecheck/lint/test for `@edmate/harness`, `@edmate/queue`, `@edmate/worker`, `prettier --check`/`--write` on the one test file, and the secret scan only)

## Exit conditions
`Status: DONE` once: (a) `types.ts`'s `CommitRecord.withheldCode` and `runner.ts`'s `Turn.sendBlockReply` `code` parameter are both narrowed to `Exclude<SafetyEventCode, 'self_harm'>` with `tsc --noEmit` clean and no change to any existing `withheldCode` test assertion's expected value; (b) the `runner.block.test.ts` indentation is either fixed (prettier-clean diff shown) or shown to already be prettier-clean with evidence quoted; (c) the `expectTypeOf` block is added to `apps/worker/src/alerts/safetyEvents.test.ts` and the manual-perturbation check is recorded in the handoff; (d) the gate above (harness, queue, worker) is green with no `src/guardrails/**` coverage regression; (e) the handoff logs the `risk: high` decision and both open-question answers (the `apps/worker` location, and whether the indentation LOW still reproduced).
`Status: PARTIAL` past ~35 tool calls, or if fixing this surfaces a need to touch `guardrails/**`, `pedagogy/**`, `content/prompt-packs/**`, `packages/contracts/**`, any file still owned by an in-flight 4.3b/4.7b-Phase-D builder, or to add a new dependency to `packages/queue`'s `package.json` — stop and report instead of proceeding.

## Lead review (4 Nov 2026)
READY. Both recommendations are accepted.
- **Q1.** The queue/db `expectTypeOf` link goes in `apps/worker/src/alerts/safetyEvents.test.ts`, which already imports both packages. `packages/queue` gains no `@edmate/db` dependency. The gate adds `--filter=...@edmate/worker`. The builder logs this departure from the title's "(packages/queue)" wording as a decision.
- **Q2.** Run `prettier --check` on `runner.block.test.ts` first. Edit it only if the flagged indentation still reproduces; otherwise record in the handoff that it was already fixed.
- **Sequencing.** Build after 4.7b Phase D merges (both touch `runner.ts`), from the latest main.
- **Review.** code-reviewer, plus a lead `risk: high` decision on merge (the `apps/worker/src/alerts/**` match). Budget: 35 tool calls.
