# 5.8f plan: one field for a passed-in role-play step

Plan written by the lead (small, well-specified task).

## Acceptance (verbatim, from the board)
"one optional field carries the role-play step with its persona id; a caller cannot pass one without the other; harness typecheck, lint and test green"

## What changes
- `packages/harness/src/pedagogy/skills.ts`: replace `SkillInput.rolePlayStep?: RolePlayStep` and `SkillInput.rolePlayStepPersonaId?: string` with one optional field
  `rolePlayStepFor?: { step: RolePlayStep; personaId: string }` (readonly fields are fine). Keep its doc comment (decidePolicy runs it before the coverage gate; it must come from the same persona, help and control; absent, it is computed here). `skillStep` keeps the same run-time check: when `rolePlayStepFor` is present and `rolePlayStepFor.personaId !== ctx.persona.id`, throw `skillStep: rolePlayStep was computed for a different persona` (same message). Otherwise use `rolePlayStepFor.step`, else compute it as today.
- `packages/harness/src/pedagogy/policy.ts:150`: pass `rolePlayStepFor: rp` (the `{ step, personaId }` built at line ~134 already has this shape) instead of the two fields.
- `packages/harness/src/pedagogy/skills.test.ts:507-518`: the mismatch test passes `rolePlayStepFor: { step: r, personaId: 'per_test_02' }` and still expects the same error. Add a type-level case (`// @ts-expect-error` on a `SkillInput` literal that sets `rolePlayStepFor` without `personaId`) so "a caller cannot pass one without the other" is proven at compile time.

No other caller exists (grep `rolePlayStepPersonaId` and `rolePlayStep:` in packages and apps, excluding dist). Behaviour does not change: no prompt-pack, ADR or contracts change.

## Test first
Change the test file first (new field name and the `@ts-expect-error` case), see typecheck fail, then change skills.ts and policy.ts.

## Files
packages/harness/src/pedagogy/skills.ts, policy.ts, skills.test.ts, docs/tasks/5.8f/handoff.md. Nothing else.

## Risky paths
`packages/harness/src/pedagogy/**` -> reviewers: code-reviewer (until the pilot gate). Reviewers: code-reviewer, typescript-reviewer. The lead logs `risk: high` at finalise.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (dependents too: apps/cli, apps/web use harness).

## Budget
Budget: 20 tool calls.

## Exit conditions
DONE when the gate is green. BLOCKED if another caller outside these files needs the old fields.
