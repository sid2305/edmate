# 3.9f review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

## Findings
- [HIGH] [fixed] apps/cli/src/commands/chat/dbRetrieval.ts — buildDbRetrieval leaked the pg pool when the documents read or the seed threw after openDatabase; now closes it and rethrows, with 3 unit tests (typescript-reviewer)
- [LOW] [wontfix] apps/cli/eslint.config.js — no-restricted-imports off for test/** is wider than the db/internal need; it copies apps/worker's config (typescript-reviewer)
- [LOW] [wontfix] pnpm-lock.yaml — churn beyond apps/cli's new deps (vitest key dedup); a pnpm side effect, and the frozen install passes (code-reviewer)
