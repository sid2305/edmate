# 7.8 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

## Findings
- [HIGH] [fixed] packages/evals/src/scorecard.ts — `ScorecardSchema.changes` was `z.array(z.string())` cast through `unknown` to `ChangeKind[]`, so `parse` accepted unknown change kinds (typescript-reviewer HIGH, code-reviewer MEDIUM). Fix round 1 uses `z.array(z.enum(CHANGE_KINDS))` and adds reject and accept tests; the lead checked the diff against the reviewer's suggested fix.
- [LOW] [deferred 7.4a] packages/evals/src/scorecard.ts — `Object.keys(SCORECARD_GROUPS) as ScorecardCategoryKey[]` casts (the accepted idiom; the reviewer says it doesn't block); fold them into a typed key list during the 7.4a gate hardening.

## Notes
- The combined pass can't hide a failing origin (test: platform locked 20/20 plus agent 9/10 gives 29/30 and pass false).
- `measured: false` (no row) and `empty_group` (row present, total 0) are kept distinct.
- The `--scorecard` write sits inside the command's existing try/catch, so a write failure prints to stderr and exits 1.
- No risky paths; no contracts, db or ADR changes.
