# 4.0c review — APPROVE
Reviewers: team lead (opus)

A small, non-risky follow-up. The lead read the diff: `loadCasesWithFiles` returns file/case pairs in the loader's own order, so `suites.ts` no longer re-lists folders or casts. `pending` is matched case-insensitively. A suite that fails to load is named as such. The reviewer and all-guards rules are on by default, with explicit opt-outs. The existing callers of `loadCasesFromDir` are unchanged. 132 tests pass; coverage on suites.ts and loader.ts is 100%.

## Findings
None.
