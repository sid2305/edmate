# Task 5.5: Tool registry and sandboxed calculator

Board: milestone M5 · deps `M3` (plan adds: start only after 5.4/PR #67 merges to `main`, so
`access/tools.ts` and the re-exports in `pipeline/tools.ts` are stable) · branch
`m5/5.5-tool-registry-calculator` · not risky · one builder, one phase.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Tool registry and sandboxed calculator"
Accept: "fuzz test shows no access outside declared scope."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| The real tool registry | `packages/harness/src/tools/registry.ts`: `defaultToolRegistry(): ToolRegistry` lists the calculator (5.6/5.7/5.8 append `practice.next_item`, feedback and role-play tools here later). `tools/registry.test.ts` checks it lists exactly the calculator today, and that piping it through the **existing, unmodified** `entitledTools`/`policyTools`/`offeredTools` (`pipeline/tools.ts`, moved to `access/tools.ts` by 5.4) filters it correctly for a subscription and a preview entitlement — proving 5.5 reuses 5.4's filter rather than re-implementing it. |
| Sandboxed calculator | `packages/harness/src/tools/calculator.ts`: a `RegisteredTool` named `calculator`, skill `coach`, input `{ expression: string }`, output `{ value: string }` — the exact shape already assumed by `pipeline/tools.test.ts` and `generate/toolLoop.test.ts`'s test doubles. `run` calls `tools/sandbox.ts`'s `evaluateExpression`. |
| Sandboxed mathjs | `packages/harness/src/tools/sandbox.ts`: one restricted `mathjs` instance (`create(all, {})`), built once, with `import` and `createUnit` overridden to throw (mathjs's own documented sandboxing pattern — matches the task's constraint exactly). An allow-list (strip known function/constant words, then a character-class check on what's left) rejects anything else — identifiers, strings, matrices/objects, assignment, member access, multiple statements — before mathjs ever sees it. No `eval`, no `new Function`, anywhere in `tools/**` (checked by a scoped ESLint rule, see below, and by grep in review). |
| Declared scope, defined | A doc comment in `tools/sandbox.ts`: the calculator's declared scope is "parse and evaluate one arithmetic expression over numbers, return a string; nothing else" — no identifiers, no units, no matrices, no strings, no filesystem/network/process/global access, bounded input length, bounded output size, a fixed error type on anything outside that. |
| Fuzz test (the acceptance line) | `packages/harness/src/tools/calculator.fuzz.test.ts`: seeded PRNG (`testing/prng.ts`, the 1.2 convention), ~2,000 iterations mixing (a) random well-formed arithmetic, (b) a fixed corpus of attack strings (`constructor`, `__proto__`, `globalThis`, `process`, `require(`, `import(`, `createUnit(`, `eval(`, `Function(`, `;`, `=`, `[`, `{`, quotes, scientific notation, Unicode homoglyphs, deeply nested parens, huge exponents), (c) pure random Unicode noise — each capped to a random length up to 2× the tool's max. For every one of the 2,000: the call either resolves with a value matching the output schema and a numeric-looking string, or rejects with `CalculatorError` only; `Object.prototype`'s own keys are unchanged before and after every call (a direct prototype-pollution detector); each call returns inside a short wall-clock budget (documented as a backstop, not the primary defence — see Q2); `import`/`createUnit` are asserted to throw directly, once, outside the loop. Prints the seed and a tally of outcomes (same shape as 5.4's property tests). |
| No contracts change | `git diff origin/main -- packages/contracts` is empty: `Tool<I,O>` (`ports.ts`) and `Skill`/`ToolName` (`shared.ts`) already cover this; `fixtures/valid/shared.ts` already has `toolCalculator = 'calculator'`. |
| No model calls | Calculator tests call `evaluateExpression`/the tool's `run` directly, or through `memoryToolRegistry`/`ScriptedGateway` (existing `testing/` fixtures). No provider adapter touched. |

## Spec it must honour

- Build plan § 5.5 (one line) and PRD "Calculator: mathjs, sandboxed — numeric checks in feedback
  and grounding" (stack table).
- Rule 3: `packages/harness` imports only `@edmate/contracts`, `zod`, `mathjs` and its own modules.
  The ESLint purity rule (`packages/config/eslint/rules/harness-purity.js`) allows exactly
  `/^mathjs$/` — **no subpath import** (`mathjs/number`, etc.), so `tools/sandbox.ts` imports
  `{ create, all }` from the root `'mathjs'` package only.
- 3.7's tool seam and 5.4's access filter are reused unchanged: `RegisteredTool`, `ToolRegistry`,
  `entitledTools`/`policyTools`/`offeredTools`, `DuplicateToolError`, `toolSpec` (now in
  `access/tools.ts`, re-exported from `pipeline/tools.ts`) and the whole of `generate/toolLoop.ts`
  (timeout, output-schema check, JSON-safety, size cap, answer-key leak check, locked-material
  check — all already built and already tested against a fake `calculator` tool with this exact
  `{expression}→{value}` shape). 5.5 adds one real tool and the registry that lists it; it does not
  touch the loop, the filter, or their tests.
- No real model or payment calls in tests (rule 4).

## Design

1. **`tools/sandbox.ts`** — the restricted mathjs instance and `evaluateExpression`.
   - Module-scope: `const restrictedMath = create(all, {})`, then
     `restrictedMath.import({ import: () => { throw new CalculatorError('import_disabled') }, createUnit: () => { throw new CalculatorError('create_unit_disabled') } }, { override: true })`
     — mathjs's own documented sandbox recipe; matches the task's "no eval and no `import` or
     `createUnit`" constraint exactly.
   - `MAX_EXPRESSION_LENGTH` (e.g. 200 chars, a harness-local constant like `TOOL_TIMEOUT_MS`;
     no contracts change). An expression over that length is rejected before any parsing.
   - Allow-list, two steps (the builder documents the exact lists in a comment):
     1. Strip every word-bounded (`\b…\b`) occurrence of a small, fixed allow-list of function and
        constant names (`sqrt abs sin cos tan asin acos atan log log10 log2 exp pow mod round floor
        ceil min max gcd lcm sign cbrt hypot pi e` — the builder trims/extends this to what a
        numeric-check/grounding calculator plausibly needs, documented).
     2. Whatever remains must match `^[0-9+\-*/^%().,\s]*$` exactly, or the expression is rejected
        (`CalculatorError('expression_rejected')`) — never reaches `restrictedMath.evaluate`.
     - This also rejects `.constructor`, `__proto__`, `globalThis`, `process`, any identifier not
       on the list, strings (quotes aren't in the character class), matrices/objects (`[`/`{`
       aren't either), assignment (`=` isn't), and multiple statements (`;` isn't). Scientific
       notation (`1e10`) is out of scope by this scheme (the standalone word `e` strips, leaving a
       stray digit sequence with no operator between — rejected); document this as a known,
       acceptable limit (Q1).
   - Evaluate inside try/catch; any throw becomes `CalculatorError('evaluation_failed')` — never
     mathjs's own message (defence in depth, matches `HarnessError`'s fixed-text convention even
     though the raw message would only ever echo the student's own input back).
   - Result → string: numbers/booleans only (`typeof result === 'number' | 'boolean'`) via
     `String(result)`; anything else (a function, a matrix, a `Map`, a `Unit`) is
     `CalculatorError('unsupported_result')` — fails closed even though the allow-list should
     already prevent it (defence in depth). Non-finite numbers (`Infinity`, `-Infinity`, `NaN`,
     e.g. from `1/0`) return as the string, not an error — a legitimate arithmetic answer.
2. **`tools/calculator.ts`** — the `RegisteredTool`: `name: 'calculator'`, `skill: 'coach'`,
   `input: z.strictObject({ expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH) })`,
   `output: z.strictObject({ value: z.string() })`, `run: async ({ expression }) => ({ value:
   evaluateExpression(expression) })`. No `present()` — a plain numeric answer, not a displayed
   skill event (Q3).
3. **`tools/registry.ts`** — `defaultToolRegistry(): ToolRegistry { return { list: () => [calculatorTool] } }`,
   a comment pointing at 5.6/5.7/5.8 to append their tools here (same shape as
   `defaultPreGuardRegistry()`). The harness's own fallback (`deps.tools ?? noTools` inline in
   `decide.ts`/`generate.ts`) is untouched — callers opt in to `defaultToolRegistry()`; wiring it
   into `apps/*`'s composition root is out of bounds here (Q4).
4. **`tools/index.ts`** — barrel; `src/index.ts` gains `export * from './tools/index.js'`.
5. **ESLint, scoped to the harness** (`packages/harness/eslint.config.js`): add `no-eval` and
   `no-new-func` to the harness's own config (not the shared `packages/config` one — smaller
   blast radius), so "no eval" is a standing, checked property of `tools/**` and every other
   harness file, not just this task's code.

## Files

- **Create:** `packages/harness/src/tools/sandbox.ts`, `sandbox.test.ts`, `calculator.ts`,
  `calculator.test.ts`, `calculator.fuzz.test.ts`, `registry.ts`, `registry.test.ts`, `index.ts`.
- **Modify:** `packages/harness/package.json` (add `mathjs`, exact pinned version — `pnpm add
  mathjs`, record the resolved version in the handoff, same convention as `zod 4.6.7`),
  `packages/harness/src/index.ts` (one export line), `packages/harness/eslint.config.js` (two
  rules), `pnpm-lock.yaml` (automatic).
- **Tests first:** `sandbox.test.ts` (import/createUnit throw; each allow-list rejection case one
  by one — identifiers, strings, matrices, assignment, semicolons, length cap, scientific
  notation; valid arithmetic incl. operator precedence, decimals, negative numbers, `1/0` →
  `"Infinity"`); then `calculator.test.ts` (schema edge cases; one pass through
  `generate/toolLoop.ts` via `memoryToolRegistry`, reusing the existing fixture pattern, to prove
  the real tool behaves like the fake one already tested there); then `registry.test.ts`; then the
  fuzz test last (it is slower and exercises everything above it).
- **Gate:** `turbo run typecheck lint test --filter=...@edmate/harness`.
- **Size:** 8 new files, 4 modified (one is the lockfile); about 110 tool calls, one phase — the
  work is one small, cohesive unit (a sandbox, a tool, a registry, a barrel), similar in shape to
  5.4 Phase A's 12 files / ~100 calls.

## Files out of bounds

- `packages/harness/src/access/**`, `packages/harness/src/pipeline/tools.ts`,
  `generate/toolLoop.ts` and their tests — 5.4's filter and 3.7's loop, reused unchanged.
- `packages/harness/src/guardrails/**`, `packages/harness/src/pedagogy/**`.
- Any other tool (`practice.next_item`, feedback, role-play) — 5.6/5.7/5.8.
- Composition-root wiring of `defaultToolRegistry()` into `apps/*` (Q4) — a later milestone.
- `packages/contracts/**`, `docs/adr/**` — no port or contract change (confirmed above).
- `packages/config/eslint/**` (the shared config) — the no-eval rule goes in the harness's own
  `eslint.config.js` only.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- None of the planned paths match a glob in `risk-paths.txt`: `packages/harness/src/tools/**` is
  not listed (the "access filter / money / isolation" group is `access/**`, `payments/**`,
  `apps/web/.../auth|webhooks`, `db/identity|repositories`, `gateway/keys` — none of those);
  `packages/harness/eslint.config.js` and `package.json` aren't `guardrails/**`, `pedagogy/**`,
  `contracts/**`, `adr/**`, `.claude/**`, `.github/**` or `.githooks/**`. **Not risky** by the
  gate's own rule, so no named reviewers are required and no `risk: high` decision is needed.
- Flagged anyway, for the lead's judgement, not the gate's (Q5): the calculator runs
  model-chosen, student-turn-reachable code against a hand-rolled sandbox. `code-reviewer` runs on
  every PR regardless; recommend asking `security-reviewer` for an informal look at
  `tools/sandbox.ts` specifically (the allow-list and the mathjs override), without blocking the
  merge on it and without logging `risk: high` (the gate doesn't require it, and MVP-first keeps
  non-required reviews out of the default path per the lead's standing rule). The architect may
  want to add `packages/harness/src/tools/**` to `risk-paths.txt` once a second tool (5.6+) lands
  in the same sandbox pattern — that's a question for them, not a blocker here.

## Decisions (draft, for the handoff)

- The fuzz test's "declared scope" means the sandbox's scope (arithmetic only; no code execution,
  no global/Node access), not the entitlement's scope (that's 5.4's property tests, already
  proven; not duplicated here) (planner, low).
- Scientific notation (`1e10`) is unsupported by design, to keep the allow-list a simple two-step
  strip-then-character-class check with no ambiguity between `e` the constant and `e` the exponent
  marker (planner, low; Q1).
- The harness's `deps.tools ?? noTools` fallback is untouched; `defaultToolRegistry()` is offered,
  not wired in, until a composition-root task picks it up (planner, low; Q4).

## Open questions (each with a recommendation)

- **Q1. Scientific notation unsupported.** Recommend: accept the limit; `1e10` can be written
  `10^10`. A future task can add it with a dedicated number-literal regex if a teacher need shows
  up.
- **Q2. A hang can't be stopped by a wall-clock race** (mathjs's `evaluate` is synchronous, and
  `generate/toolLoop.ts`'s `TOOL_TIMEOUT_MS` race can't preempt a blocking synchronous call once
  it has started; it only catches hangs that never resolve, e.g. an infinite `Promise`). Recommend
  the primary defence is the allow-list plus mathjs's default plain-`number` config (not
  `BigNumber`), which makes overflow return `Infinity` in O(1) rather than hang; the fuzz test's
  per-call wall-clock assertion is a backstop that would catch a regression, not the main proof.
  Flag to the lead as a design limit of "sandboxed" here, not a defect to fix in 5.5.
- **Q3. No `present()` for the calculator** (no `skill` event; the model just uses the number in
  its text reply). Recommend: yes, matches the PRD's framing ("numeric checks in feedback and
  grounding", not a displayed skill like practice items). 5.6+ tools that are themselves the
  lesson (practice items) will want `present()`; the calculator doesn't need one.
- **Q4. Composition-root wiring.** Recommend: out of bounds here, as in 5.4's plan. Whichever task
  first stands up `apps/worker`'s real `PipelineDeps` (M8/9) passes `defaultToolRegistry()` for
  `tools`.
- **Q5. Should `tools/**` join `risk-paths.txt`'s access-filter group?** Recommend: not for this
  task (the gate wouldn't require it and the planner shouldn't add to the architect-owned file
  unprompted); raise it to the architect as a candidate once a second sandboxed tool exists, so
  the group reflects a real pattern rather than one file.

## Lead answers (20 Oct 2026)
- **Q1:** accepted. Scientific notation is unsupported by design.
- **Q2:** accepted as a design limit. Narrow it further: cap the expression length (200 characters), allow only a named list of functions, and refuse anything that could make evaluate slow. The fuzz test asserts a per-call wall-clock bound.
- **Q3:** accepted. No `present()` and no skill event.
- **Q4:** accepted. Offer `defaultToolRegistry()`; wiring it into apps comes later.
- **Q5:** accepted. Don't touch risk-paths.txt now. Because the sandbox is security-sensitive, the lead will still run security-reviewer on this PR.
