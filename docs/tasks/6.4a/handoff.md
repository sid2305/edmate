# Handoff: 6.4a

Status: PARTIAL (Phase A done; Phase B to do)

## Phase A

Topic-scored evidence producer (`@edmate/harness`), test first, per `docs/tasks/6.4a/plan.md`.

- `packages/harness/src/pipeline/tools.ts` — `IssuedItem` gets an optional `topicId?: string`.
- `packages/harness/src/tools/practice.ts` — a new `topicIdFor(itemId, scope)` helper (parallel to
  `answerKeyFor`: the bank's own `topicId` first, else the generator's parsed id) resolves the
  topic the model never sees; `issuedItem()` attaches it to the `IssuedItem` it returns.
- `packages/harness/src/pedagogy/helpState.ts` — `HelpState` gets an optional `practiceTopicId`,
  parallel to `practiceModuleId`; `practiceFields()` carries it over on every saved state. A blob
  saved before 6.4a still parses (no `practiceTopicId`).
- `packages/harness/src/pipeline/runner.ts` — `withPractice()` sets `practiceTopicId: last.topicId`
  alongside `practiceModuleId` when an item went out. A new `private turnSkill` field records
  decide's skill for the turn; a new `private evidenceFor(e, ctx)` method builds one
  `EvidenceEvent` (`studentId`/`teacherId` from `e.entitlement`, `topicId` from the *loaded* help
  state — the item the student is grading this turn — `correct: ctx.attempt === 'correct'`,
  `source: 'practice'`, `weight: 1`, `ts`) when the turn's skill is `practice` and `ctx.attempt` is
  `'correct'` or `'wrong'`; `finish()` attaches it to `CommitRecord.evidence`. No context, no
  practice skill, an unsettled attempt (`'none'`/`'partial'`), or no stored `practiceTopicId` (the
  defensive gap) all mean no event; the method never throws.

### Tests first (red → green)
- `packages/harness/src/pipeline/runner.evidence.test.ts` (new): 6 cases — a correct practice
  answer emits one `EvidenceEvent` with the held topic; a wrong one emits `correct: false`; a
  non-practice skill, an unsettled attempt (`'partial'`, `'none'`), and a held item with no stored
  topic all emit none. Verified red first: with the `evidence` wiring in `finish()` temporarily
  reverted, the "correct" and "wrong" cases failed (`expected [...] + Received: undefined`); with
  it restored, all 6 pass.
- `packages/harness/src/pedagogy/helpState.test.ts`: extended `PRACTICE` with `practiceTopicId`
  and added a case for a pre-6.4a blob with `practiceModuleId` but no topic; `copyHelp` and
  `practiceFields` assertions updated to cover it.
- `packages/harness/src/tools/practice.test.ts`: the two existing `issuedItem()` equality
  assertions (a bank item, a generated item) extended with the new `topicId` field they now return
  (`'fractions'`, `'module-arithmetic:practice'`).

Confirmed by grep (plan's dependents check): `IssuedItem` and `practiceTopicId` do not appear
outside `packages/harness/src`, so `@edmate/harness`'s exported surface is unchanged and no
dependent package needed re-gating beyond the gate command below.

## Decisions

### 27 Oct 2026 · 6.4a helpState.ts practiceTopicId · decided by builder · risk: high
- Decided: add `practiceTopicId?: string` to `HelpState` (`packages/harness/src/pedagogy/
  helpState.ts`), parallel to `practiceModuleId`, carried by `practiceFields()`/`copyHelp()`; a
  blob saved before this task still parses (the field is simply absent).
- Why: the plan calls for it directly and flags `packages/harness/src/pedagogy/**` as a risky path
  under the MVP-first rule in `risk-paths.txt` — logged `risk: high` per that rule, not because the
  change itself is risky (it is a narrow, additive, optional string field with no behavior change
  to existing saved state).

### 27 Oct 2026 · 6.4a evidence topic source · decided by builder · risk: low
- Decided: the `EvidenceEvent`'s `topicId` comes from the *loaded* help state
  (`this.loadedHelp?.help.practiceTopicId`, i.e. the item the student held before this turn and is
  now grading), not from any item issued during this same turn.
- Why: `ctx.attempt` is computed by classifying the student's text against the loaded
  `answerKey` (the item they are answering); a freshly issued item this turn has no graded attempt
  yet. The plan's runner.ts bullet names `help.practiceTopicId` without saying which help state,
  and this is the only one `finish()` has in scope that matches the already-computed `attempt`.

### 27 Oct 2026 · 6.4a decide's skill routed through a new `turnSkill` field · decided by builder · risk: low
- Decided: added a private `turnSkill: Skill | null` field, set from `decided.skill` right after
  decide, and read inside `finish()`'s new `evidenceFor` helper, instead of threading `skill`
  through `CommitRecord`/`rec`.
- Why: `decided.skill` is local to `main()`; `finish()` is the one place every outcome path (error,
  blocked, escalated, replied) funnels through to build `CommitRecord`, and the field avoids
  widening `CommitRecord` or every `finish()` call site for a value only this new producer reads.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness   (dependents form, lead answer)
corepack pnpm --filter @edmate/harness typecheck lint test                 (leaf, run alone)
```
- `@edmate/harness` typecheck: pass.
- `@edmate/harness` lint (`corepack pnpm --filter @edmate/harness lint`): pass, no findings.
- `@edmate/harness` tests run alone (`corepack pnpm --filter @edmate/harness test`, no other
  workspace package competing for CPU): **128 files / 5681 tests passed**, including the new
  `runner.evidence.test.ts` (6/6) and the extended `helpState.test.ts` / `practice.test.ts`.
- The dependents-form gate (`--filter=...@edmate/harness`, every workspace package building/
  testing together) was run twice on this machine; both times it failed on the same **two
  pre-existing, unrelated timing tests** once everything else (evals' 630+ seeded safety cases,
  content, web, cli, worker) was running in parallel and starving the harness test workers'
  wall-clock budget: `src/pedagogy/modelRequest.test.ts`'s "runs in linear time on long hostile
  input" (a `ratio < 64` performance assertion; observed 82–161 under contention) and
  `src/pipeline/runner.test.ts`'s "a soft hit never escalates..." (a hardcoded 2000ms test
  timeout). Neither test touches anything this task changed (6.4a added no new regex, loop or
  distress-check code). Re-run alone, `modelRequest.test.ts` passed 86/86. I could not get a
  single all-green run of the full dependents-form command on this machine inside this phase's
  budget; the leaf-alone result above is what I'm standing behind as green. Left to do for a
  future pass (or Phase B's builder, who also must gate `...@edmate/harness`): either accept this
  machine's contention as a known flake (not caused by 6.4a) or re-run the dependents form on a
  quieter window.
- `corepack pnpm exec prettier --check` on every file this phase touched: pass (after one
  `--write` on the new test file to match the repo's formatting).
- `python3 .githooks/secret-scan.py --all`: clean.

## Budget

Phase A tool calls used: 68 (over the ~45 planned; most of the overrun was waiting on this
machine's contended, serialized dependents-form gate run — see Gate above)
