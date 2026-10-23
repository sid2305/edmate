# 7.3b: per-agent suite generator polish

Status: DONE

## What changed

1. `packages/evals/src/perAgentSuite.ts`: `PerAgentSuiteError` now takes a `readonly reason`
   (`'no-packages' | 'id-collision' | 'invalid-case'`, exported as `PerAgentSuiteErrorReason`) and
   a `constructor(reason, message, options?: { cause?: unknown })` that passes `options` to
   `super()`, matching `CaseLoadError` in `loader.ts`. All three throw sites pass their reason; the
   invalid-case site also passes `{ cause: parsed.error }` so the underlying zod error survives.
2. `perAgentSuite.ts`: the locked-case loop now iterates `LOCKED_TEMPLATES` (with `'direct'`
   handled inline before falling through to `MODULE_MESSAGES[template]`) instead of separately
   looping the answerable items and then `Object.entries(MODULE_MESSAGES)`. `LOCKED_TEMPLATES` is
   the single source of template order; `MODULE_MESSAGES` only supplies the per-template message
   function. Generated output (ids, order, content) is unchanged — the existing order-pinning
   tests (`'makes every template for each locked module...'`, `'lists locked modules in
   first-appearance order'`) pass unmodified.
3. `packages/evals/src/loader.ts`: `NoCasesFoundError`'s message now uses `displayPath(dir)`
   instead of the raw `dir`, like `CaseLoadError`. The `readonly dir` field is unchanged.

Also updated/added tests:
- `perAgentSuite.test.ts`: the three throw-site tests now also assert `.name ===
  'PerAgentSuiteError'`, `.reason` for each case, and that `.cause` is `undefined` for
  `id-collision`/`no-packages` and defined for `invalid-case`.
- `loader.test.ts`: the `NoCasesFoundError` test now also asserts the message equals
  `` `${displayPath(dir)}: no .yaml or .yml cases found` `` (no other test matched the old raw-path
  message text, so nothing else needed updating).
- `packages/evals/src/index.ts`: appended `type PerAgentSuiteErrorReason` to the existing
  `perAgentSuite.js` export block (append-only; no other export changed).

## Evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`:
```
Tests       31 passed (31)
     Tests  1415 passed (1415)
All files  100% stmts / 94.92% branch / 100% funcs / 100% lines (unchanged overall; perAgentSuite.ts
           and loader.ts both 100% stmts/branch/funcs/lines)
 Tasks:    18 successful, 18 total
```
`python3 .githooks/secret-scan.py --all`: clean (no output, exit 0).

## Decisions

### 22 Oct 2026 · 7.3b ran over budget · decided by lead · risk: low
- Decided: accept 59 tool calls against a 40-call budget; both reviews approve with no findings.
- Why: the builder counted 26; the harness counted 59 (install, the evals gate with its dependencies, a merge of main and a re-run). The work is done and clean, so a second round would only cost more.
- risk: low

### 22 Oct 2026 · PerAgentSuiteError structured field is `reason`, not an id · decided by builder · risk: low
- Decided: added a `readonly reason: 'no-packages' | 'id-collision' | 'invalid-case'` field
  rather than an offending-id field.
- Why: one of the three throw sites (`no-packages`) has no case id to name — only `agentId`,
  already in the message — so a single `reason` union is the field that fits every throw site
  uniformly, as the brief allowed ("pick one that fits the existing throw sites").
- risk: low

Tool calls used: 59 (harness count: builder 59; the agent reported 26)
