# 9.6g review — APPROVE

Reviewers: typescript-reviewer (sonnet; also as code-reviewer), lead

All five deferred 9.6b findings are fixed, each with a test that fails without the fix. The fixes cover the PDF bullet byte and width reserve, the C1 control-character strip, exact-timestamp pairing in answeredPairs, a real ExportCursor type with no casts, and fromError logging only the error name. The reviewer hand-checked the 40-"M" wrap boundary and the tie case. No packages/db change.

## Findings
- [LOW] [deferred 9.6f] apps/web/src/export/notes.ts — the exact-timestamp branch of answeredPairs doesn't mark its match as used, so a later question's fallback search could reuse that teacher message (only with malformed duplicate-timestamp rows).
