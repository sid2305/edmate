# 5.5a plan — calculator follow-ups

Status: READY (lead-written plan, 25 Oct 2026)

Source: `docs/tasks/5.5/review.md` lines 8–9 (deferred 5.5a) and the board title.

## Items
1. **Implicit multiplication (MEDIUM).** `packages/harness/src/tools/sandbox.ts` (around line 136):
   the tokenizer lets implicit multiplication through when a space or `)` separates terms. Refuse
   a number, constant/name or `)` followed (after optional whitespace) by a number, a name or `(`.
   Must refuse: `1 e 2`, `2 pi`, `sqrt(4)pi`, `(1)(2)`, `(1)(2)(3)`, `sin(1)(2)`, `2 3`, `2 (3)`,
   `pi e`. Must still accept: function calls `sqrt(4)`, `sin(pi/2)`, `2*pi`, `(1)*(2)`,
   `-(2)`, `2^(3)`, unit-free scientific notation the sandbox accepted before (e.g. `1e2`, `1.5e-3`)
   — check what the existing tests accept and keep it. Refusal uses the sandbox's existing refusal
   shape with a clear reason; add every refused form to the rejection table in `sandbox.test.ts`
   and to the fuzz attack corpus in `calculator.fuzz.test.ts`. Fix the doc comment that claims
   implicit multiplication is already refused.
2. **gcd/lcm above 2^53 (LOW).** `sandbox.ts` (around line 44): `gcd(2^1000,3)` returns 3. Pick the
   simpler safe option: drop `gcd` and `lcm` from the allow-list (check that no prompt pack, eval
   case, practice bank or doc names them — `grep -rn "gcd\|lcm" packages evals docs`); if something
   relies on them, instead refuse any argument that is not a safe integer. Test it either way.
3. **Lazy mathjs instance.** Create the restricted mathjs instance on first use, not at module
   load (eager `create(all)` dominates test import time). Keep it a single cached instance; no
   behaviour change; a test that two evaluations share it is enough (or cover via existing tests).

## Rules
- `packages/harness` imports only contracts, zod, mathjs and its own modules.
- `src/tools/**` is not a risk path. Reviewers: code-reviewer, typescript-reviewer.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`; 100% coverage on
`src/tools` stays.

## Budget
About 60 tool calls.
