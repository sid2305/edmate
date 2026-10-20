# Task 5.5 handoff: tool registry and sandboxed calculator

- **Status:** DONE
- **Branch:** `m5/5.5-tool-registry-calculator`
- **Worktree:** `.claude/worktrees/agent-a10d639795fd337c2` (under the repo root)
- **Plan:** `docs/tasks/5.5/plan.md` (with the lead answers of 20 Oct 2026)

## What was built

- `packages/harness/src/tools/sandbox.ts`: one restricted mathjs instance
  (`create(all, { number: 'number', predictable: true })`) with `import`, `createUnit`,
  `evaluate`, `parse`, `compile`, `simplify`, `derivative` and `resolve` overridden to throw
  (mathjs's documented sandbox recipe; `evaluate` is captured first). `evaluateExpression` runs:
  type check, 200-character cap (`CALCULATOR_MAX_EXPRESSION_LENGTH`), empty check, then a
  tokenizer allow-list before mathjs sees the text. Tokens are ASCII numbers, `+ - * / ^ % ( ) ,`,
  spaces/tabs, and names from two named lists: `ALLOWED_FUNCTIONS` (abs acos asin atan cbrt ceil
  cos exp floor gcd hypot lcm log log10 log2 max min mod pow round sign sin sqrt tan) and
  `ALLOWED_CONSTANTS` (pi e). A function must be followed by `(`, a constant must not be, a name may
  not directly follow a number, and a number may not be followed by `.`. Any mathjs throw becomes
  `CalculatorError('evaluation_failed')`; only a `number` result is returned (`toResultString`),
  anything else is `unsupported_result`. `CalculatorError` is a `HarnessError` with a fixed
  message `calculator: <reason>`. The declared scope is written out in the file comment.
- `tools/calculator.ts`: `calculatorTool`, a `RegisteredTool` named `calculator`, skill `coach`,
  input `z.strictObject({ expression: z.string().min(1).max(200) })`, output
  `z.strictObject({ value: z.string() })`, no `present()` (Q3). Its description lists the allowed
  names, built from the two lists so it cannot drift.
- `tools/registry.ts`: `defaultToolRegistry()` lists exactly the calculator; 5.6–5.8 append theirs.
  Not wired into any app (Q4).
- `tools/index.ts` barrel; `src/index.ts` exports it.
- `packages/harness/eslint.config.js`: `no-eval`, `no-implied-eval`, `no-new-func` for the whole
  harness.
- `packages/harness/vitest.config.ts`: `src/tools/**` at 100% coverage.
- `packages/harness/package.json`: `mathjs` pinned at **15.2.0** (exact).

## Tests (written first; red confirmed before `sandbox.ts` existed)

- `sandbox.test.ts`: the 8 disabled functions throw; `CalculatorError` shape; 36 valid
  expressions (precedence, decimals, negatives, `%`, every function, `1/0` → `Infinity`, `0/0` →
  `NaN`, `10^10^10` → `Infinity`, `sqrt(-1)` → `NaN`); the allow-lists are real mathjs names; the
  exact 200-character boundary; 57 rejections one by one (identifiers, `constructor`, `__proto__`,
  `globalThis`, `process`, `require`, `import`, `createUnit`, `eval`, `Function`, member access,
  strings, matrices, objects, assignment, `;`, newline, comparison, `!`, ternary, scientific
  notation, homoglyphs, zero-width and full-width characters); fixed-text evaluation errors;
  `toResultString` fails closed on non-numbers.
- `calculator.test.ts`: tool shape, run, schema edge cases, JSON Schema carries `maxLength: 200`;
  one pass through the real `runToolLoop` with `memoryToolRegistry` + `ScriptedGateway`: a valid
  call returns `{ value: '0.75' }` to the model; an out-of-scope call is `ToolFailed(failed,
  CalculatorError)` and the model never sees the input echoed.
- `registry.test.ts`: lists exactly the calculator; the unchanged `entitledTools`/`policyTools`/
  `offeredTools` offer it to a subscription and a preview, and not to an entitlement without coach.
- `calculator.fuzz.test.ts` (the acceptance line): seeded PRNG (`testing/prng.ts`), 2,000 inputs
  mixing random arithmetic, a 64-string attack corpus (alone or spliced into arithmetic) and random
  BMP noise, each cut to a random length up to 2× the cap. Each call must resolve to a schema-valid,
  numeric-looking string or reject with `CalculatorError` only, finish under 250 ms wall-clock, and
  leave the own keys of `Object.prototype`, `Function.prototype`, `Array.prototype`,
  `Number.prototype`, `String.prototype` and `globalThis` unchanged. `import`/`createUnit` are
  asserted to throw once, outside the loop.

## Acceptance evidence

```
$ corepack pnpm vitest run src/tools --reporter=verbose   (packages/harness)
calculator fuzz: seed 1516160028, {"valid":658,"attack":671,"noise":671,"resolved":658,"rejected":1342},
  reasons {"bad_name_use":77,"too_long":166,"unknown_name":597,"evaluation_failed":69,"bad_character":433}, slowest 13ms
 Test Files  4 passed (4)
      Tests  147 passed (147)

$ PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force --concurrency=1
@edmate/harness:test: Test Files 98 passed (98)   Tests 4457 passed (4457)
@edmate/harness:test: All files | 98.91 | 97.11 | 98.22 | 99.37
@edmate/harness:test:   calculator.ts | 100 | 100 | 100 | 100
@edmate/harness:test:   registry.ts   | 100 | 100 | 100 | 100
@edmate/harness:test:   sandbox.ts    | 100 | 100 | 100 | 100
 Tasks:    38 successful, 38 total

$ python3 .githooks/secret-scan.py --all
(clean, no output)

$ git diff origin/main --stat -- packages/contracts
(empty)
```

## Changes

- Created: `packages/harness/src/tools/{sandbox,calculator,registry,index}.ts`,
  `{sandbox,calculator,registry}.test.ts`, `calculator.fuzz.test.ts`.
- Modified: `packages/harness/package.json` (mathjs 15.2.0), `src/index.ts` (one export line),
  `eslint.config.js` (three rules), `vitest.config.ts` (100% for `src/tools/**`), `pnpm-lock.yaml`.
- Not touched: `access/**`, `pipeline/tools.ts`, `pipeline/generate/toolLoop.ts`, `guardrails/**`,
  `pedagogy/**`, `packages/contracts/**`, `risk-paths.txt`.

## Deviations from the plan

1. **A tokenizer instead of strip-then-character-class.** The plan's two-step check would let
   `pi.e` through (both names strip, leaving `.`, which is in the character class), which reaches
   mathjs's member access. The tokenizer also rejects `sqrt.constructor`, `sqrt["x"]`, calling a
   constant, using a function as a value, a name glued to a number (`2pi`, `1e+5`, which mathjs
   would otherwise read as scientific notation), and newlines. Same goal, tighter.
2. **The constant is `CALCULATOR_MAX_EXPRESSION_LENGTH`**, not `MAX_EXPRESSION_LENGTH`:
   `pipeline/generate/arithmetic.ts` already exports a `MAX_EXPRESSION_LENGTH` (64) through the
   package barrel, so the plain name would clash.
3. **`predictable: true`**, not `create(all, {})`: without it `sqrt(-1)` returns a Complex object.
   With it every allowed function returns a plain number (`NaN` for non-real results).
4. **Only `number` results are returned, not `boolean`**: no allowed token can produce a boolean
   (no comparison or logic operators), so accepting one would only be an untested branch.
5. **More mathjs functions disabled** (`evaluate`, `parse`, `compile`, `simplify`, `derivative`,
   `resolve` as well as `import`, `createUnit`): the full documented recipe.
6. **`no-implied-eval` added** alongside `no-eval` and `no-new-func`.
7. **`src/tools/**` set to 100% coverage**: the sandbox handles model-chosen input.
8. Fuzz per-call bound is 250 ms (slowest observed 13 ms), so a busy CI machine doesn't flake while
   a real hang still fails.

## Decisions

### 20 Oct 2026 · 5.5 Calculator allow-list is a tokenizer · decided by tdd-guide
Decided: The calculator checks input with a tokenizer allow-list (ASCII numbers, `+ - * / ^ % ( ) ,`, spaces and tabs, and names from two named lists, with rules for where each name may appear), not with the plan's strip-then-character-class check.
Why: The planned check let `pi.e` reach mathjs's member access. The tokenizer closes that gap and also refuses glued forms like `2pi` and `1e+5`, which keeps scientific notation unsupported as Q1 decided.

### 20 Oct 2026 · 5.5 Allowed calculator functions · decided by tdd-guide
Decided: The calculator allows abs acos asin atan cbrt ceil cos exp floor gcd hypot lcm log log10 log2 max min mod pow round sign sin sqrt tan and the constants pi and e. Nothing slow on a large argument (factorial, gamma, combinations, isPrime and similar) and nothing that builds matrices, units, strings or functions.
Why: The lead's Q2 answer asked for a named list and for refusing anything that could make evaluate slow. These cover numeric checks in feedback and grounding.

### 20 Oct 2026 · 5.5 mathjs runs in predictable number mode · decided by tdd-guide
Decided: The restricted mathjs instance uses `number: 'number'` and `predictable: true`, and only a plain number result is returned. Infinity and NaN come back as strings.
Why: Without predictable mode `sqrt(-1)` returns a Complex object. Plain numbers also make overflow return Infinity at once instead of running slowly.

### 20 Oct 2026 · 5.5 Calculator length constant is renamed · decided by tdd-guide
Decided: The 200-character cap is exported as `CALCULATOR_MAX_EXPRESSION_LENGTH`.
Why: The harness barrel already exports a `MAX_EXPRESSION_LENGTH` (64) from the grounding arithmetic checker. Reusing the name would clash.

### 20 Oct 2026 · 5.5 Harness-wide no-eval lint and full coverage for tools · decided by tdd-guide
Decided: The harness ESLint config adds `no-eval`, `no-implied-eval` and `no-new-func`. `src/tools/**` must have 100% coverage.
Why: The sandbox handles model-chosen input. These checks keep code-from-text out of the harness, and they keep every sandbox branch tested as later tools land there.
