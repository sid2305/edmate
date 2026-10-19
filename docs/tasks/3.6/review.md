# 3.6 review — APPROVE
Reviewers: safety-reviewer (opus), security-reviewer (sonnet), typescript-reviewer (sonnet)

See safety-review.md for the safety findings and the answer-key verdict. security-reviewer found no path traversal in the pack loader (names are lookup keys only), fail-closed validation, fenced injection with adversarial tests, and correctly formatted stricter risk-paths lines (122 .claude tests OK). typescript-reviewer confirmed a pure, deterministic composer, the decide interface unchanged, help-state `next` and pack versions on CommitRecord, harness purity, and canary tests that locked text reaches no model, commit or trace. Harness 2,097 tests, content 120 after the fix round.

## Findings
- [HIGH] [fixed] packages/harness/src/pedagogy/compose.ts:203 — the answer key was in the prompt on every move. Teaching moves only now; closed modes tested clean. Re-verified by safety-reviewer.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/compose.ts:194 — distress turns used the redirect move line and listed skills. Own decision line now. Re-verified by safety-reviewer.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/modelRequest.ts:27 — cache key could be misused as an app-level cache. Documented as a provider hint only. Re-verified by safety-reviewer.
- [LOW] [fixed] packages/harness/src/pedagogy/compose.ts — persona fields weren't fenced. Fenced now.
- [LOW] [fixed] packages/content/src/promptPacks.ts — path-safety invariant was implicit. Pinned by a test.
- [LOW] [deferred 4.7] packages/harness/src/pedagogy/compose.ts:117 — chunk text can contain fake `[n]` citation lines; grounding must reject numbers above n.
- [LOW] [deferred 3.8] packages/harness/src/pipeline/types.ts — CommitRecord `next`/`decision` hold the answer key; commit must never write them to a transcript.
