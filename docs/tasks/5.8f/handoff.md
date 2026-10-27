# Handoff: 5.8f
Status: DONE

## Summary
Replaced the two linked optional fields on `SkillInput` (`rolePlayStep?: RolePlayStep` and
`rolePlayStepPersonaId?: string`) with one optional field `rolePlayStepFor?: { readonly step:
RolePlayStep; readonly personaId: string }`, so a caller cannot pass one without the other.

- `packages/harness/src/pedagogy/skills.ts`: `SkillInput.rolePlayStepFor` replaces the two
  fields (doc comment kept, updated to describe the merged field). `skillStep` now checks
  `i.rolePlayStepFor !== undefined && i.rolePlayStepFor.personaId !== persona.id` and throws the
  same message (`skillStep: rolePlayStep was computed for a different persona`); it reads
  `i.rolePlayStepFor?.step ?? rolePlayStep({ ... })` otherwise.
- `packages/harness/src/pedagogy/policy.ts:150`: passes `rolePlayStepFor: rp` (the `{ step,
  personaId }` object already built at line ~134) instead of the two separate fields.
- `packages/harness/src/pedagogy/skills.test.ts`: the mismatch test now passes
  `rolePlayStepFor: { step: r, personaId: 'per_test_02' }` and still expects the same thrown
  message. Added a new type-level test (`5.8f: a caller cannot pass a role-play step without its
  persona id (type-level)`) with a `SkillInput` literal using `// @ts-expect-error` on
  `rolePlayStepFor: { step: r }` (no `personaId`), proving the constraint at compile time.
  Imported `type SkillInput` from `./skills.js` for this.

Grepped `rolePlayStepPersonaId` and `rolePlayStep:` across `packages` and `apps` (excluding
`dist`) before changing: no caller exists outside `skills.ts`, `policy.ts` and
`skills.test.ts`. Behaviour is unchanged; no prompt-pack, ADR or contracts change.

## Red then green
- Red: after changing only `skills.test.ts` (new field name + `@ts-expect-error` case) and
  before touching `skills.ts`/`policy.ts`, `corepack pnpm turbo run typecheck --filter=...@edmate/harness`
  failed with
  `src/pedagogy/skills.test.ts(521,9): error TS2561: Object literal may only specify known
  properties, but 'rolePlayStepFor' does not exist in type 'SkillInput'.`
- Green: after updating `skills.ts` and `policy.ts`, the full gate (`typecheck lint test`) passed
  for harness and its dependents (see below).

## Decisions

### 27 Oct 2026 · 5.8f merge of pedagogy/skills.ts and policy.ts · decided by lead · risk: high
- Decided: merge the `SkillInput.rolePlayStepFor` change in `packages/harness/src/pedagogy/` (a risky path).
- Why: code-reviewer and typescript-reviewer both approved with no findings; the change is type-only, keeps the same run-time persona check and message, and nothing different reaches the model.

### 27 Oct 2026 · 5.8f budget overrun · decided by lead · risk: low
- Decided: accept the overrun (30 harness tool calls against a budget of 20; the builder reported 17-21).
- Why: the extra calls went to the full dependents gate and a re-run of the known apps/cli chatDbRetrieval flake; the diff stayed on scope.

### 27 Oct 2026 · 5.8f one field for a passed-in role-play step · decided by builder · risk: low
- Decided: merged `rolePlayStep`/`rolePlayStepPersonaId` into one `rolePlayStepFor: { step,
  personaId }` field, matching the shape already built in `policy.ts`, with `readonly` members.
- Why: the acceptance criterion requires a caller to be unable to pass one without the other;
  one object field with both members required is the simplest way to make that a compile-time
  guarantee, and it matches the object already constructed at the call site.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: all packages passed
  except `@edmate/cli#test`, which failed only in `test/chatDbRetrieval.int.test.ts` with the
  known shared-Postgres flake (`error: terminating connection due to administrator command`,
  `Hook timed out in 10000ms` in `beforeAll`). 161 passed, 2 skipped in that run; every other test
  file and package (including `@edmate/harness`, `@edmate/web`) passed.
- Re-run of the flaking file alone: `corepack pnpm vitest run test/chatDbRetrieval.int.test.ts`
  (from `apps/cli`) — 1 passed, 1 skipped, clean. Confirms it was the shared-Postgres flake named
  in the brief, not a regression from this change.
- `corepack pnpm exec prettier --check` on the three changed files: "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all`: clean (no output, exit 0).

## Budget
Tool calls used: 30 (harness count; the builder reported 17)
