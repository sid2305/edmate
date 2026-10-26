# 12.3e handoff

Status: DONE

## Summary
Fixed the two 12.3b review LOWs:
- `packages/db/src/repositories/chunks.ts`: ran `prettier --write`; the diff is formatting
  only (wrapped a long `if` condition and the `select({...})` call onto multiple lines; this
  also restored the JSDoc line's leading asterisk the review flagged).
- `packages/db/test/documents.int.test.ts`: replaced the non-null assertions after
  `expect(...).not.toBeNull()` with narrowing guards (`if (x === null) throw new Error(...)`)
  at the two spots the plan named (around lines 470-473 and 523-527). No other `x!.` after such
  an expect existed in the file. Ran `prettier --write` afterwards to keep formatting clean;
  test behaviour is unchanged.

## Decisions
The builder made no decisions (the plan was followed exactly).

### 25 Oct 2026 · 12.3e budget over cap · decided by lead · risk: low
- Decided: accept 38 harness-counted builder tool calls against a cap of 15.
- Why: the full @edmate/db gate needed a rerun after an unrelated harness timing flake (modelRequest.test.ts, a known flake); the change itself is small and both reviewers approved.

### 25 Oct 2026 · 12.3e merge · decided by lead · risk: high
- Decided: merge 12.3e. It touches packages/db/src/repositories/chunks.ts (a risky path, security-reviewer group); code-reviewer and security-reviewer confirmed the change is whitespace-only reformatting, and the test guards keep the tests' meaning.
- Why: no behaviour change, the gate passes, no findings.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` → all 26 tasks
  successful (one run hit a known-flaky unrelated timing test in
  `@edmate/harness` `modelRequest.test.ts` on a loaded machine; a clean rerun passed all 26
  tasks, `@edmate/db` tasks passed in both runs).
- `corepack pnpm exec prettier --check packages/db/src/repositories/chunks.ts packages/db/test/documents.int.test.ts`
  → "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Budget
Tool calls used: 38 (harness count; the builder reported 22)
